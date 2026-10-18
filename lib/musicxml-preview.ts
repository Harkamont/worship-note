import { XMLParser } from 'fast-xml-parser';
import { analyzeMusicXML } from './musicxml-review.ts';

// These are browser rendering limits, not MusicXML validity or musical edits.
// A refused preview must leave the original document available for download.
export const MUSICXML_PREVIEW_LIMITS = Object.freeze({
  parts: 16, stavesPerPart: 8, totalStaves: 32, staffLines: 12,
  voicesPerPart: 16, measuresPerPart: 512, totalMeasures: 2048,
  notes: 10_000, pageBreaks: 64,
});

class PreviewLimitError extends Error {
  constructor(label: string) {
    super(`MusicXML 미리보기 안전 한도를 넘었거나 지원하지 않는 값이 있습니다 (${label}). 원본 XML과 검토 내용은 계속 다운로드할 수 있습니다.`);
    this.name = 'MusicXMLPreviewLimitError';
  }
}
const fail = (label: string): never => { throw new PreviewLimitError(label); };
type OrderedNode = Record<string, unknown>;

function boundedNumber(raw: string, label: string, min: number, max: number, integer = false): number {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())) return fail(label);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) return fail(label);
  return value;
}

/** Run before importing/constructing OSMD; this function never invokes it. */
export function assertMusicXMLPreviewSafe(xml: string): void {
  const parsingXML = xml.replace(/^\uFEFF/, '');
  let review;
  try { review = analyzeMusicXML(parsingXML); }
  catch { return fail('XML 구조·크기'); }
  const limits = MUSICXML_PREVIEW_LIMITS;
  if (review.partCount > limits.parts || review.totalPartMeasures > limits.totalMeasures || review.noteCount > limits.notes) fail('파트·마디·음표 수');
  let totalStaves = 0;
  for (const part of review.parts) {
    if (part.staffCount > limits.stavesPerPart || part.measures.length > limits.measuresPerPart || part.voiceIds.length > limits.voicesPerPart) fail('파트별 보표·마디·성부 수');
    totalStaves += part.staffCount;
    for (const measure of part.measures) {
      if (measure.expectedQuarterBeats !== null && measure.expectedQuarterBeats > 256) fail('한 마디 박자');
      if (measure.durationQuarterBeats !== null && measure.durationQuarterBeats > 512) fail('한 마디 길이');
      for (const event of measure.events) {
        if (event.durationQuarterBeats !== null && event.durationQuarterBeats > 256) fail('음표 길이');
        if (event.onsetQuarterBeats !== null && Math.abs(event.onsetQuarterBeats) > 512) fail('음표 위치');
      }
    }
  }
  if (totalStaves > limits.totalStaves) fail('전체 보표 수');

  // Inspect raw numeric instructions too: the review intentionally preserves
  // information it cannot fully interpret, while OSMD uses some values as loop
  // or array bounds (notably staves and staff-lines in OSMD 2.2.1 readers).
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '',
    parseTagValue: false, parseAttributeValue: false, trimValues: false, removeNSPrefix: true,
    ignoreDeclaration: true, ignorePiTags: true, processEntities: true });
  const tree = parser.parse(parsingXML) as OrderedNode[];
  let pageBreaks = 0;
  const ranges: Record<string, [number, number, boolean?]> = {
    staves: [1, limits.stavesPerPart, true], staff: [1, limits.stavesPerPart, true],
    'staff-lines': [0, limits.staffLines, true], octave: [0, 9, true], 'display-octave': [0, 9, true],
    fifths: [-14, 14, true], alter: [-4, 4], 'key-alter': [-4, 4], 'root-alter': [-4, 4], 'bass-alter': [-4, 4], 'degree-alter': [-4, 4],
    divisions: [1, 1_000_000, true], duration: [1, 100_000_000, true], 'beat-type': [1, 1024, true],
    'actual-notes': [1, 64, true], 'normal-notes': [1, 64, true], 'tuplet-number': [1, 64, true],
    'multiple-rest': [1, limits.measuresPerPart, true], 'measure-repeat': [1, 16, true],
    line: [0, limits.staffLines, true], 'clef-octave-change': [-4, 4, true], 'octave-change': [-8, 8, true],
    chromatic: [-96, 96], diatonic: [-56, 56, true], tremolo: [0, 8, true],
    'page-height': [100, 10_000], 'page-width': [100, 10_000],
    'left-margin': [0, 5000], 'right-margin': [0, 5000], 'top-margin': [0, 5000], 'bottom-margin': [0, 5000],
    'system-distance': [0, 2000], 'top-system-distance': [0, 2000], 'staff-distance': [0, 2000],
    millimeters: [0.1, 100], tenths: [1, 1000], 'staff-size': [1, 400], 'line-width': [0, 100],
    string: [1, 32, true], fret: [0, 100, true], 'per-minute': [1, 1000],
  };
  const staffNumberElements = new Set(['clef', 'key', 'time', 'staff-details', 'staff-layout', 'measure-style']);
  const numberedNotation = new Set(['slur', 'tie', 'tied', 'tuplet', 'wedge', 'pedal', 'bracket', 'dashes', 'octave-shift', 'part-group']);

  const visit = (entries: OrderedNode[]) => {
    for (const entry of entries) {
      const name = Object.keys(entry).find(key => key !== ':@');
      if (!name || name === '#text') continue;
      const children = Array.isArray(entry[name]) ? entry[name] as OrderedNode[] : [];
      const attributes = (entry[':@'] ?? {}) as Record<string, string>;
      const raw = children.filter(child => Object.hasOwn(child, '#text')).map(child => String(child['#text'])).join('').trim();
      if (ranges[name]) boundedNumber(raw, name, ...ranges[name]);
      if (name === 'beats') {
        if (!/^\d+(?:\s*\+\s*\d+)*$/.test(raw)) fail('박자 수');
        const terms = raw.split('+');
        if (terms.length > 32 || terms.reduce((sum, term) => sum + boundedNumber(term, '박자 수', 1, 64, true), 0) > 64) fail('박자 수');
      }
      if (name === 'voice') {
        if (!raw || raw.length > 32) fail('성부 식별자');
        if (/^[+-]?[\d.]+(?:e[+-]?\d+)?$/i.test(raw)) boundedNumber(raw, '성부 번호', 1, 128, true);
      }
      if (name === 'note' && children.filter(child => Object.hasOwn(child, 'dot')).length > 8) fail('점음표 수');
      if (name === 'print' && attributes['new-page'] === 'yes' && ++pageBreaks > limits.pageBreaks) fail('페이지 수');
      if (attributes.number !== undefined && staffNumberElements.has(name)) boundedNumber(attributes.number, '보표 번호', 1, limits.stavesPerPart, true);
      if (attributes.number !== undefined && numberedNotation.has(name)) boundedNumber(attributes.number, '기호 번호', 1, 128, true);
      if (name === 'octave-shift' && attributes.size !== undefined) boundedNumber(attributes.size, '옥타브 이동', 1, 22, true);
      if (name === 'measure' && attributes.width !== undefined) boundedNumber(attributes.width, '마디 너비', 1, 10_000);
      if (name === 'measure' && attributes.osmdWidthFactor !== undefined) boundedNumber(attributes.osmdWidthFactor, '마디 너비 배율', 0.1, 10);
      for (const key of ['default-x', 'default-y', 'relative-x', 'relative-y']) if (attributes[key] !== undefined) boundedNumber(attributes[key], '배치 위치', -10_000, 10_000);
      visit(children);
    }
  };
  visit(tree);
}
