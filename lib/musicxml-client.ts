import { validateScore } from './music.ts';
import { analyzeMusicXML } from './musicxml-review.ts';
import type { MusicXMLReviewIssue } from './musicxml-review.ts';
import type { MusicXMLRecognitionResult } from './recognition.ts';

import { createRepairContext, validateMergedRepair, type MusicXMLRepairSelection } from './musicxml-measure-repair.ts';

export type MusicXMLRepairResult = MusicXMLRecognitionResult & { repair: { selection: MusicXMLRepairSelection; originalXML: string; changedMeasureNumbers: string[] } };

type Options = { signal?: AbortSignal; fetcher?: (url: string, options?: RequestInit) => Promise<Response> };
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const responseError = () => new Error('MusicXML 변환 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  let onAbort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([promise, stopped]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

async function readJSON(response: Response, signal?: AbortSignal): Promise<unknown> {
  if (!response.body) throw responseError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('MusicXML 변환 응답이 너무 큽니다.');
      chunks.push(value);
    }
    signal?.throwIfAborted();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw responseError(); }
  } finally {
    // Cancellation must not wait for a stream whose cancel() never settles.
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A cancelled read may still be settling. */ }
  }
}

function validateResult(value: unknown): MusicXMLRecognitionResult {
  if (!record(value) || !record(value.document) || typeof value.document.xml !== 'string' || !text(value.model, 200) || !text(value.provider, 100) || !number(value.elapsedMs)) throw responseError();
  if (!(value.editorIssue === null || (text(value.editorIssue, 64 * 1024) && new TextEncoder().encode(value.editorIssue).byteLength <= 64 * 1024))) throw responseError();
  if (value.cost !== undefined && !number(value.cost)) throw responseError();
  let usage: MusicXMLRecognitionResult['usage'] = null;
  if (value.usage !== null) {
    if (!record(value.usage)) throw responseError();
    const { inputTokens, outputTokens, totalTokens, cachedTokens } = value.usage;
    if (![inputTokens, outputTokens, totalTokens, cachedTokens].every(n => number(n) && Number.isSafeInteger(n))) throw responseError();
    usage = { inputTokens: inputTokens as number, outputTokens: outputTokens as number, totalTokens: totalTokens as number, cachedTokens: cachedTokens as number };
  }
  const document = { ...analyzeMusicXML(value.document.xml.replace(/^\uFEFF/, '')), xml: value.document.xml };
  if (value.document.issues !== undefined) {
    if (!Array.isArray(value.document.issues) || value.document.issues.length > 10_000) throw responseError();
    const known = new Set(document.issues.map(issue => JSON.stringify(issue)));
    for (const issue of value.document.issues) {
      if (!record(issue) || !['error', 'warning'].includes(String(issue.severity)) || !text(issue.code, 100) || !text(issue.message, 4000) || (issue.partId !== undefined && !text(issue.partId, 128)) || (issue.measure !== undefined && !text(issue.measure, 128))) throw responseError();
      const clean: MusicXMLReviewIssue = { severity: issue.severity as MusicXMLReviewIssue['severity'], code: issue.code, message: issue.message, ...(issue.partId === undefined ? {} : { partId: issue.partId as string }), ...(issue.measure === undefined ? {} : { measure: issue.measure as string }) };
      const key = JSON.stringify(clean);
      if (!known.has(key)) { document.issues.push(clean); known.add(key); }
    }
  }
  return {
    document,
    score: value.score === null ? null : validateScore(value.score),
    editorIssue: value.editorIssue,
    model: value.model,
    provider: value.provider,
    elapsedMs: value.elapsedMs,
    usage,
    ...(value.cost === undefined ? {} : { cost: value.cost }),
  };
}

async function requestMusicXML(endpoint: string, file: File, options: Options, musicxml?: string, selection?: MusicXMLRepairSelection): Promise<MusicXMLRecognitionResult> {
  options.signal?.throwIfAborted();
  const body = new FormData(); body.append('image', file);
  // Multipart text decoders may consume a leading BOM. Use an explicit wire
  // representation and restore the exact source prefix before validating merge.
  const uploadXML = selection ? musicxml?.replace(/^\uFEFF/, '') : musicxml;
  if (uploadXML !== undefined) body.append('musicxml', uploadXML);
  if (selection) body.append('selection', JSON.stringify(selection));
  const response = await abortable((options.fetcher ?? fetch)(endpoint, { method: 'POST', body, signal: options.signal }), options.signal);
  options.signal?.throwIfAborted();
  const data = await readJSON(response, options.signal);
  options.signal?.throwIfAborted();
  if (!response.ok) {
    if (record(data) && record(data.error) && text(data.error.message, 500)) {
      const detail = text(data.error.details, 500) ? ` ${data.error.details}` : '';
      const billing = record(data.billing) && number(data.billing.cost) ? ` 이번 AI 요청의 보고된 API 비용은 $${data.billing.cost.toFixed(6)}입니다.` : '';
      throw new Error(data.error.message + detail + billing);
    }
    throw responseError();
  }
  const result = validateResult(data);
  if (selection) {
    if (!record(data) || !record(data.repair) || data.repair.originalXML !== uploadXML || JSON.stringify(data.repair.selection) !== JSON.stringify(selection) || !Array.isArray(data.repair.changedMeasureNumbers) || data.repair.changedMeasureNumbers.some(value=>typeof value!=='string')) throw responseError();
    const mergedXML = musicxml!.startsWith('\uFEFF') && !result.document.xml.startsWith('\uFEFF') ? '\uFEFF' + result.document.xml : result.document.xml;
    const verified = validateMergedRepair(musicxml!, selection, mergedXML, musicxml);
    if (JSON.stringify(verified.changedMeasureNumbers) !== JSON.stringify(data.repair.changedMeasureNumbers)) throw responseError();
    const { parseMusicXML } = await import('./musicxml-import.ts');
    options.signal?.throwIfAborted();
    let score: MusicXMLRecognitionResult['score'] = null;
    let editorIssue: string | null = null;
    try { score = parseMusicXML(verified.xml.replace(/^\uFEFF/, ''), { reviewDraft: true }); }
    catch (cause) { editorIssue = cause instanceof Error ? cause.message.slice(0, 8000) : '편집기가 지원하지 않는 악보 구성입니다. XML 파일로 확인해 주세요.'; }
    return {...result,document:{...result.document,xml:verified.xml},score,editorIssue,repair:{selection,originalXML:musicxml!,changedMeasureNumbers:verified.changedMeasureNumbers}} as MusicXMLRepairResult;
  }
  return result;
}

export async function recognizeMusicXML(file: File, options: Options = {}): Promise<MusicXMLRecognitionResult> {
  return requestMusicXML('/api/recognize-xml', file, options);
}

export async function recognizeOMRMusicXML(file: File, options: Options = {}): Promise<MusicXMLRecognitionResult> {
  return requestMusicXML('/api/omr-xml', file, options);
}

export class MusicXMLHybridError extends Error {
  draft: MusicXMLRecognitionResult;
  constructor(message: string, draft: MusicXMLRecognitionResult, cause: unknown) {
    super(message);
    this.name = cause instanceof Error && cause.name === 'AbortError' ? 'AbortError' : 'MusicXMLHybridError';
    this.draft = draft;
  }
}

export async function recognizeHybridMusicXML(file: File, options: Options & { onDraft?: (draft: MusicXMLRecognitionResult) => void } = {}): Promise<MusicXMLRecognitionResult> {
  const draft = await requestMusicXML('/api/omr-xml', file, options);
  try {
    options.onDraft?.(draft);
    options.signal?.throwIfAborted();
    const annotated = await requestMusicXML('/api/annotate-xml', file, options, draft.document.xml);
    const elapsedMs = draft.elapsedMs + annotated.elapsedMs;
    if (!number(elapsedMs)) throw responseError();
    const cost = draft.cost === undefined || annotated.cost === undefined ? undefined : draft.cost + annotated.cost;
    return { ...annotated, model: `${draft.model} + ${annotated.model}`.slice(0, 200), provider: `${draft.provider} + ${annotated.provider}`.slice(0, 100), elapsedMs, ...(cost !== undefined && number(cost) ? { cost } : { cost: undefined }) };
  } catch (cause) {
    throw new MusicXMLHybridError(cause instanceof Error ? cause.message : '코드·가사 추가를 완료하지 못했습니다.', draft, cause);
  }
}

/** Local review only: returning a Score never replaces the editor by itself. */
export async function reviewMusicXMLFile(file: File, options: Pick<Options, 'signal'> = {}): Promise<MusicXMLRecognitionResult> {
  options.signal?.throwIfAborted();
  const compressed = /\.mxl$/i.test(file.name);
  if (file.size > (compressed ? 10 : 2) * 1024 * 1024) throw new Error(compressed ? '압축 MusicXML 검토는 10MB 이하 파일을 지원합니다.' : '원본 XML 검토는 2MB 이하 파일을 지원합니다.');
  const started = Date.now();
  const bytes = await abortable(file.arrayBuffer(), options.signal);
  options.signal?.throwIfAborted();
  const { readMusicXMLFile, parseMusicXML } = await import('./musicxml-import.ts');
  options.signal?.throwIfAborted();
  const xml = await abortable(readMusicXMLFile(new Uint8Array(bytes), file.name), options.signal);
  options.signal?.throwIfAborted();
  const parsingXML = xml.replace(/^\uFEFF/, '');
  const document = { ...analyzeMusicXML(parsingXML), xml };
  options.signal?.throwIfAborted();
  let score: MusicXMLRecognitionResult['score'] = null;
  let editorIssue: string | null = null;
  try { score = parseMusicXML(parsingXML); }
  catch (cause) { editorIssue = cause instanceof Error ? cause.message : '편집기가 지원하지 않는 XML입니다. 원본 XML과 검토 내용을 확인해 주세요.'; }
  return { document, score, editorIssue, model: '직접 불러온 MusicXML', provider: 'local-file', elapsedMs: Date.now() - started, usage: null };
}

export async function repairMusicXMLMeasures(file: File, originalXML: string, selection: MusicXMLRepairSelection, options: Options = {}): Promise<MusicXMLRepairResult> {
  const normalized = createRepairContext(originalXML, selection).selection;
  return await requestMusicXML('/api/repair-xml', file, options, originalXML, normalized) as MusicXMLRepairResult;
}
