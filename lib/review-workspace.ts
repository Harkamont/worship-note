import type { RecognitionResult, RecognitionUsage } from './score-types.ts';
import type { MusicXMLRecognitionResult } from './recognition.ts';
import { analyzeMusicXML, type MusicXMLReviewIssue } from './musicxml-review.ts';
import { listMusicXMLMelodySources, type MelodySelection } from './musicxml-melody.ts';
import { createRepairContext, type MusicXMLRepairSelection } from './musicxml-measure-repair.ts';
import { reviewExtractedMelody } from './musicxml-melody-client.ts';

export type ReviewMode = 'direct' | 'hybrid' | 'local';
export type ReviewReceipt = Omit<RecognitionResult, 'score'>;
export type SourceReviewNotice = Omit<MusicXMLReviewIssue, 'severity'> & { severity: 'warning' };
export interface ReviewMelody { selection: MelodySelection | null; xml: string | null; warnings: string[] }
/** Durable inputs only. Parsed reviews, editor Scores and File objects are rebuilt. */
export interface ReviewMeasureRepair { xml: string; selection: MusicXMLRepairSelection; receipts: ReviewReceipt[] }
export interface ReviewWorkspace {
  version: 1;
  sourceXML: string;
  sourceImage: string | null;
  sourceName: string;
  /** Recognition notices that cannot be recreated from the XML alone. */
  sourceNotices: SourceReviewNotice[];
  receipt: ReviewReceipt;
  mode: ReviewMode;
  melody: ReviewMelody;
  measureRepair?: ReviewMeasureRepair;
  /** Manual editor changes must not be replaced from an older XML snapshot. */
  editorChanged?: boolean;
}

const MAX_IMAGE_URL = 14 * 1024 * 1024;
const MAX_XML_BYTES = 2 * 1024 * 1024;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(field + ' 형식이 올바르지 않습니다.');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(field + ' 길이 또는 형식이 올바르지 않습니다.');
  return value;
}
function number(value: unknown, field: string, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isSafeInteger(value))) throw new Error(field + ' 숫자가 올바르지 않습니다.');
  return value;
}
export function normalizeImageDataURL(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_IMAGE_URL) throw new Error('원본 이미지 data URL은 14MiB 이하여야 합니다.');
  const prefix = /^data:image\/(png|jpeg);base64,/.exec(value);
  if (!prefix) throw new Error('원본은 PNG 또는 JPEG data URL이어야 합니다.');
  const encoded = value.slice(prefix[0].length);
  if (!encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('원본 이미지의 base64 형식이 올바르지 않습니다.');
  if ((encoded.endsWith('==') && BASE64.indexOf(encoded[encoded.length - 3]) % 16 !== 0) || (encoded.endsWith('=') && !encoded.endsWith('==') && BASE64.indexOf(encoded[encoded.length - 2]) % 4 !== 0)) throw new Error('원본 이미지의 base64 채움 비트가 올바르지 않습니다.');
  const bytes = Array.from(atob(encoded.slice(0, 12)), character => character.charCodeAt(0));
  const validPNG = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const validJPEG = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((prefix[1] === 'png' && !validPNG) || (prefix[1] === 'jpeg' && !validJPEG)) throw new Error('원본 이미지의 실제 PNG/JPEG 서명이 일치하지 않습니다.');
  return value;
}
export function normalizeRecognitionMetadata(value: unknown): ReviewReceipt {
  const raw = object(value, '인식 정보');
  let usage: RecognitionUsage | null = null;
  if (raw.usage !== null) {
    const tokens = object(raw.usage, '사용 토큰');
    usage = {
      inputTokens: number(tokens.inputTokens, '입력 토큰', 1_000_000_000, true),
      outputTokens: number(tokens.outputTokens, '출력 토큰', 1_000_000_000, true),
      totalTokens: number(tokens.totalTokens, '전체 토큰', 1_000_000_000, true),
      cachedTokens: number(tokens.cachedTokens, '캐시 토큰', 1_000_000_000, true),
    };
  }
  return {
    model: text(raw.model, '인식 모델', 200, true),
    provider: text(raw.provider, '인식 서비스', 100, true),
    elapsedMs: number(raw.elapsedMs, '인식 시간', 86_400_000), usage,
    ...(raw.cost !== undefined ? { cost: number(raw.cost, 'API 비용', 1_000_000) } : {}),
  };
}
function xml(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_XML_BYTES || new TextEncoder().encode(value).byteLength > MAX_XML_BYTES) throw new Error('검토 XML은 2MiB 이하여야 합니다.');
  analyzeMusicXML(value.replace(/^\uFEFF/, ''));
  return value;
}
export function emptyReviewMelody(): ReviewMelody { return { selection: null, xml: null, warnings: [] }; }

const issueKey = (issue: MusicXMLReviewIssue) => JSON.stringify([issue.severity, issue.code, issue.message, issue.partId ?? null, issue.measure ?? null]);
function sourceNotices(value: unknown): SourceReviewNotice[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1000) throw new Error('원본 검토 문구는 1000개 이하여야 합니다.');
  const notices: SourceReviewNotice[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const entry of value) {
    const raw = object(entry, '원본 검토 문구');
    if (raw.severity !== 'warning') throw new Error('보관할 원본 검토 문구는 확인 안내여야 합니다. 구조 오류는 XML에서 다시 검사합니다.');
    const notice: SourceReviewNotice = {
      severity: 'warning', code: text(raw.code, '원본 검토 코드', 100, true), message: text(raw.message, '원본 검토 문구', 8000, true),
      ...(raw.partId !== undefined ? { partId: text(raw.partId, '원본 검토 파트', 256, true) } : {}),
      ...(raw.measure !== undefined ? { measure: text(raw.measure, '원본 검토 마디', 256, true) } : {}),
    };
    bytes += new TextEncoder().encode(JSON.stringify(notice)).byteLength;
    if (bytes > 512 * 1024) throw new Error('원본 검토 문구는 합계 512KiB 이하여야 합니다.');
    const key = issueKey(notice);
    if (!seen.has(key)) { notices.push(notice); seen.add(key); }
  }
  return notices;
}

export function normalizeReviewWorkspace(value: unknown): ReviewWorkspace {
  const raw = object(value, 'XML 검토 작업');
  if (raw.version !== 1) throw new Error('지원하지 않는 XML 검토 작업 버전입니다.');
  if (raw.mode !== 'direct' && raw.mode !== 'hybrid' && raw.mode !== 'local') throw new Error('XML 검토 방식이 올바르지 않습니다.');
  const sourceXML = xml(raw.sourceXML);
  const melody = object(raw.melody, '멜로디 작업');
  let selection: MelodySelection | null = null;
  if (melody.selection !== null) {
    const selected = object(melody.selection, '멜로디 성부');
    selection = { partId: text(selected.partId, '파트 ID', 256, true), staff: text(selected.staff, '보표', 256, true), voice: text(selected.voice, '성부', 256, true) };
    if (!listMusicXMLMelodySources(sourceXML.replace(/^\uFEFF/, '')).some(candidate => candidate.partId === selection!.partId && candidate.staff === selection!.staff && candidate.voice === selection!.voice)) throw new Error('선택한 멜로디 성부가 원본 XML에 없습니다.');
  }
  if (!Array.isArray(melody.warnings) || melody.warnings.length > 10_000) throw new Error('멜로디 검토 문구 수가 올바르지 않습니다.');
  const warnings = melody.warnings.map(message => text(message, '멜로디 검토 문구', 8000, true));
  const derivedXML = melody.xml === null ? null : xml(melody.xml);
  if ((!selection && derivedXML !== null) || (derivedXML === null && warnings.length > 0)) throw new Error('멜로디 XML·선택 성부·검토 문구가 서로 맞지 않습니다.');
  let measureRepair: ReviewMeasureRepair | undefined;
  if (raw.editorChanged !== undefined && typeof raw.editorChanged !== 'boolean') throw new Error('편집 악보 변경 표시가 올바르지 않습니다.');
  if (raw.measureRepair !== undefined) {
    const repair = object(raw.measureRepair, '마디 AI 수정 작업');
    const repairXML = xml(repair.xml);
    const selection = createRepairContext(repairXML.replace(/^\uFEFF/, ''), repair.selection as MusicXMLRepairSelection).selection;
    if (!Array.isArray(repair.receipts) || repair.receipts.length < 1 || repair.receipts.length > 32) throw new Error('마디 AI 사용 내역은 1~32개여야 합니다.');
    measureRepair = { xml: repairXML, selection, receipts: repair.receipts.map(normalizeRecognitionMetadata) };
  }
  return {
    version: 1, sourceXML, sourceImage: normalizeImageDataURL(raw.sourceImage), sourceName: text(raw.sourceName, '검토 원본 이름', 256), sourceNotices: sourceNotices(raw.sourceNotices),
    receipt: normalizeRecognitionMetadata(raw.receipt), mode: raw.mode, melody: { selection, xml: derivedXML, warnings }, ...(measureRepair ? {measureRepair} : {}), editorChanged: raw.editorChanged === undefined ? true : raw.editorChanged,
  };
}

export function createReviewWorkspace(result: MusicXMLRecognitionResult, source: Pick<ReviewWorkspace, 'sourceImage' | 'sourceName' | 'mode'>, melody: ReviewMelody = emptyReviewMelody()): ReviewWorkspace {
  const regenerated = new Set(analyzeMusicXML(result.document.xml.replace(/^\uFEFF/, '')).issues.map(issueKey));
  const notices = result.document.issues.filter(issue => issue.severity === 'warning' && !regenerated.has(issueKey(issue)));
  return normalizeReviewWorkspace({ version: 1, sourceXML: result.document.xml, ...source, sourceNotices: notices, receipt: result, melody, editorChanged: false });
}

/** Re-analyze local XML; restoration never starts recognition or fills missing data. */
export function restoreReviewWorkspace(value: unknown): { workspace: ReviewWorkspace; result: MusicXMLRecognitionResult; melodyResult: MusicXMLRecognitionResult | null; measureRepairResult: MusicXMLRecognitionResult | null } {
  const workspace = normalizeReviewWorkspace(value);
  const seed = { ...workspace.receipt } as MusicXMLRecognitionResult;
  const result = reviewExtractedMelody(seed, { xml: workspace.sourceXML.replace(/^\uFEFF/, ''), warnings: [] });
  result.document.xml = workspace.sourceXML;
  const regenerated = new Set(result.document.issues.map(issueKey));
  result.document.issues.push(...workspace.sourceNotices.filter(notice => !regenerated.has(issueKey(notice))).map(notice => ({ ...notice })));
  const melodyResult = workspace.melody.xml === null ? null : reviewExtractedMelody(result, { xml: workspace.melody.xml.replace(/^\uFEFF/, ''), warnings: workspace.melody.warnings });
  if (melodyResult) melodyResult.document.xml = workspace.melody.xml!;
  const measureRepairResult = workspace.measureRepair ? restoreMeasureRepair(workspace) : null;
  return { workspace, result, melodyResult, measureRepairResult };
}

/** An unknown paid charge remains unknown when aggregating requests. */
export function combineRepairReceipts(initial: ReviewReceipt, receipts: ReviewReceipt[]): ReviewReceipt {
  const all = [initial, ...receipts];
  const free = (receipt: ReviewReceipt) => receipt.provider === 'local-file' || receipt.provider === 'local-omr';
  const costKnown = all.every(receipt=>receipt.cost !== undefined || free(receipt));
  const tokenKnown = all.every(receipt=>receipt.usage !== null || free(receipt));
  const usage = tokenKnown ? all.reduce((sum,receipt)=>({inputTokens:sum.inputTokens+(receipt.usage?.inputTokens??0), outputTokens:sum.outputTokens+(receipt.usage?.outputTokens??0), totalTokens:sum.totalTokens+(receipt.usage?.totalTokens??0), cachedTokens:sum.cachedTokens+(receipt.usage?.cachedTokens??0)}), {inputTokens:0,outputTokens:0,totalTokens:0,cachedTokens:0}) : null;
  return normalizeRecognitionMetadata({model:initial.model.slice(0,140)+` + 부분 AI ${receipts.length}회`,provider:initial.provider.slice(0,70)+' + measure-ai',elapsedMs:all.reduce((sum,receipt)=>sum+receipt.elapsedMs,0),usage,...(costKnown?{cost:all.reduce((sum,receipt)=>sum+(receipt.cost??0),0)}:{})});
}
export function restoreMeasureRepair(workspace: ReviewWorkspace): MusicXMLRecognitionResult | null {
  const repair = workspace.measureRepair;
  if (!repair) return null;
  const seed = combineRepairReceipts(workspace.receipt, repair.receipts) as MusicXMLRecognitionResult;
  const result = reviewExtractedMelody(seed, {xml:repair.xml.replace(/^\uFEFF/, ''),warnings:[]}, {reviewDraft:true});
  result.document.xml = repair.xml;
  return result;
}
