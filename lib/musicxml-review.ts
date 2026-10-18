import { XMLParser, XMLValidator } from 'fast-xml-parser';

const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_XML_DEPTH = 64;
const MAX_XML_NODES = 100_000;
const EPSILON = 1e-7;
const TYPE_BEATS: Record<string, number> = {
  maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1,
  eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
  '128th': 0.03125, '256th': 0.015625, '512th': 0.0078125, '1024th': 0.00390625,
};

export interface MusicXMLReviewIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  partId?: string;
  measure?: string;
}
export interface MusicXMLReviewLyric {
  /** MusicXML verse identifiers are strings, not necessarily integers. */
  number: string;
  name?: string;
  text: string;
  syllabic?: string;
  extend: boolean;
  endLine?: boolean;
}
export interface MusicXMLReviewEvent {
  index: number;
  /** Written pitch in MIDI semitones; fractional alterations are retained. */
  pitchMidi: number | null;
  rest: boolean;
  unpitched: boolean;
  grace: boolean;
  chord: boolean;
  /** Null means invalid/missing timing data, not a zero-duration note. */
  durationQuarterBeats: number | null;
  onsetQuarterBeats: number | null;
  tieStart: boolean;
  tieStop: boolean;
  voice: string;
  staff: string;
  lyrics: MusicXMLReviewLyric[];
}
export interface MusicXMLReviewChord {
  index: number;
  root: { step: string; alter: number } | null;
  bass: { step: string; alter: number } | null;
  kind: string;
  kindText: string;
  offsetQuarterBeats: number | null;
  onsetQuarterBeats: number | null;
  staff: string;
}
export interface MusicXMLReviewChange {
  type: 'key' | 'time' | 'divisions';
  value: string;
  onsetQuarterBeats: number | null;
  staff?: string;
}
export interface MusicXMLReviewMeasure {
  /** Zero-based ordinal, separate from potentially nonnumeric/repeated number. */
  index: number;
  number: string;
  implicit: boolean;
  expectedQuarterBeats: number | null;
  /** Furthest occupied/explicitly forwarded time, never sum of parallel voices. */
  durationQuarterBeats: number | null;
  events: MusicXMLReviewEvent[];
  chords: MusicXMLReviewChord[];
  changes: MusicXMLReviewChange[];
}
export interface MusicXMLReviewPart {
  id: string;
  name: string;
  staffCount: number;
  voiceIds: string[];
  measures: MusicXMLReviewMeasure[];
}
export interface MusicXMLLyricVerse {
  identifier: string;
  partId: string;
  voice: string;
  staff: string;
  number: string;
  name?: string;
}
export interface MusicXMLReview {
  version: 1;
  /** Exact input, including declarations; analysis never repairs/re-exports it. */
  xml: string;
  title: string;
  partCount: number;
  /** Maximum measure count of a single part; not a sum across parts. */
  measureCount: number;
  totalPartMeasures: number;
  /** All note elements, including rests, grace notes and additional chord tones. */
  noteCount: number;
  /** Harmony elements, distinct from simultaneous note/chord tones. */
  chordCount: number;
  lyricVerses: MusicXMLLyricVerse[];
  /** Separate part/staff/voice/verse streams in printed measure order. */
  lyricsText: string;
  parts: MusicXMLReviewPart[];
  issues: MusicXMLReviewIssue[];
}

type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };
type Meter = { signature: string; quarters: number | null };
type AddIssue = (severity: MusicXMLReviewIssue['severity'], code: string, message: string) => void;
const children = (node: XmlNode | undefined, name: string) => (node?.children ?? []).filter(child => child.name === name);
const first = (node: XmlNode | undefined, name: string) => node?.children.find(child => child.name === name);
const content = (node?: XmlNode): string => node ? node.text + node.children.map(content).join('') : '';
const value = (node: XmlNode | undefined, name: string) => content(first(node, name)).trim();
const exists = (node: XmlNode | undefined, name: string) => Boolean(first(node, name));
function number(raw: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
  const result = Number(raw);
  return Number.isFinite(result) ? result : null;
}

/** Enforce limits before the XML library creates its nested representation. */
function boundedXml(xml: string): XmlNode {
  if (new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) throw new Error('XML 파일은 2MB 이하여야 합니다.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) throw new Error('XML에 사용할 수 없는 제어 문자가 있습니다.');
  let cursor = 0;
  let depth = 0;
  let nodes = 0;
  let doctypeCount = 0;
  let rootStarted = false;
  let keptFrom = 0;
  const kept: string[] = [];
  const countNode = () => {
    if (++nodes > MAX_XML_NODES) throw new Error('XML 항목 수가 너무 많아 구조를 읽을 수 없습니다.');
  };
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start < 0) break;
    if (start > cursor && xml.slice(cursor, start).trim()) countNode();
    if (xml.startsWith('<!--', start) || xml.startsWith('<![CDATA[', start) || xml.startsWith('<?', start)) {
      const terminator = xml.startsWith('<!--', start) ? '-->' : xml.startsWith('<?', start) ? '?>' : ']]>';
      const end = xml.indexOf(terminator, start + 2);
      if (end < 0) throw new Error('XML 주석·선언·문자열이 닫히지 않았습니다.');
      countNode();
      cursor = end + terminator.length;
      continue;
    }
    let quote = '';
    let end = start + 1;
    for (; end < xml.length; end++) {
      const character = xml[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end === xml.length) throw new Error('XML 태그가 닫히지 않았습니다.');
    const tag = xml.slice(start, end + 1);
    if (/^<!DOCTYPE\b/.test(tag)) {
      // No DTD is loaded. A simple external declaration can be removed from the
      // analysis copy; internal subsets and all entity declarations are rejected.
      if (++doctypeCount > 1 || rootStarted || depth !== 0 || tag.includes('[') || /<!ENTITY\b/i.test(tag)
          || !/^<!DOCTYPE\s+[\w:.-]+(?:\s+SYSTEM\s+(?:"[^"]*"|'[^']*')|\s+PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*'))?\s*>$/.test(tag)) {
        throw new Error('XML 내부 DTD와 사용자 정의 엔터티 선언은 허용하지 않습니다.');
      }
      kept.push(xml.slice(keptFrom, start));
      keptFrom = end + 1;
    } else if (tag.startsWith('<!')) throw new Error('XML DTD·엔터티 선언을 읽을 수 없습니다.');
    else if (tag.startsWith('</')) {
      if (--depth < 0) throw new Error('XML 태그 구조가 올바르지 않습니다.');
    } else {
      rootStarted = true;
      countNode();
      if (++depth > MAX_XML_DEPTH) throw new Error('XML 구조의 깊이가 너무 큽니다.');
      if (/\/\s*>$/.test(tag)) depth--;
    }
    cursor = end + 1;
  }
  kept.push(xml.slice(keptFrom));
  const cleaned = kept.join('');
  const entitySource = cleaned.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  if (/&(?!(?:amp|lt|gt|apos|quot);|#\d+;|#x[\da-fA-F]+;)/.test(entitySource)) throw new Error('XML에 지원하지 않는 엔터티가 있습니다.');
  for (const match of entitySource.matchAll(/&#(x[\da-fA-F]+|\d+);/g)) {
    const code = match[1].startsWith('x') ? parseInt(match[1].slice(1), 16) : Number(match[1]);
    if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) {
      throw new Error('XML 문자 참조가 올바르지 않습니다.');
    }
  }
  if (XMLValidator.validate(cleaned) !== true) throw new Error('XML 문법이 올바르지 않습니다.');
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false,
    parseAttributeValue: false, trimValues: false, removeNSPrefix: true, ignoreDeclaration: true, ignorePiTags: true, processEntities: true });
  const parsed = parser.parse(cleaned) as Record<string, unknown>[];
  const convert = (entry: Record<string, unknown>): XmlNode => {
    const name = Object.keys(entry).find(key => key !== ':@');
    if (!name) throw new Error('XML 항목 이름이 없습니다.');
    const node: XmlNode = { name, attrs: (entry[':@'] ?? {}) as Record<string, string>, children: [], text: '' };
    const items = entry[name];
    if (Array.isArray(items)) for (const item of items as Record<string, unknown>[]) {
      if (Object.hasOwn(item, '#text')) node.text += String(item['#text']);
      else node.children.push(convert(item));
    }
    return node;
  };
  if (parsed.length !== 1) throw new Error('XML 최상위 항목은 하나여야 합니다.');
  const root = convert(parsed[0]);
  if (root.name !== 'score-partwise') throw new Error('파트별 MusicXML(score-partwise) 문서가 필요합니다.');
  return root;
}

function readMeter(node: XmlNode): Meter | null {
  if (exists(node, 'senza-misura')) return { signature: 'senza-misura', quarters: null };
  const beats = children(node, 'beats');
  const units = children(node, 'beat-type');
  if (!beats.length || beats.length !== units.length) return null;
  let quarters = 0;
  const signatures: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const raw = content(beats[i]).trim();
    const numerators = raw.split('+').map(part => number(part.trim()));
    const denominator = number(content(units[i]).trim());
    if (numerators.some(n => n === null || n <= 0 || !Number.isInteger(n))
      || denominator === null || denominator <= 0 || !Number.isInteger(denominator)) return null;
    quarters += (numerators as number[]).reduce((sum, n) => sum + n, 0) * 4 / denominator;
    signatures.push(raw + '/' + denominator);
  }
  return Number.isFinite(quarters) ? { signature: signatures.join('+'), quarters } : null;
}

function readLyrics(note: XmlNode): MusicXMLReviewLyric[] {
  return children(note, 'lyric').map(lyric => ({
    number: lyric.attrs.number || '1', ...(lyric.attrs.name ? { name: lyric.attrs.name } : {}),
    text: lyric.children.filter(child => child.name === 'text' || child.name === 'elision').map(content).join(''),
    ...(value(lyric, 'syllabic') ? { syllabic: value(lyric, 'syllabic') } : {}), extend: exists(lyric, 'extend'), ...(exists(lyric, 'end-line') ? { endLine: true } : {}),
  }));
}
/** Match sectionLyricText's syllabic/extension policy without creating a Score. */
function lyricStreamText(lines: Map<number, MusicXMLReviewLyric[]>): string {
  const ordered = [...lines.entries()].sort(([a], [b]) => a - b).map(([, entries]) => entries);
  const plain = (text: string) => /^[\s\-‐‑‒–—―−_＿]+$/u.test(text) ? '' : text;
  const entries = ordered.flat();
  if (!entries.some(entry => entry.syllabic || entry.extend || entry.endLine)) {
    return ordered.map(line => line.map(entry => plain(entry.text)).join('').trim()).filter(Boolean).join('\n');
  }
  let output = '';
  let wordEnded = false;
  for (const entry of entries) {
    const text = plain(entry.text);
    if (text) {
      if (wordEnded && output && !/\s$/.test(output) && !/^\s/.test(text)) output += ' ';
      output += text;
      wordEnded = entry.syllabic === 'single' || entry.syllabic === 'end';
    }
    if (entry.endLine) { output = output.trimEnd() + '\n'; wordEnded = false; }
  }
  return output.trim();
}

function writtenPitch(note: XmlNode, add: AddIssue): number | null {
  const pitch = first(note, 'pitch');
  if (!pitch) {
    if (!exists(note, 'rest') && !exists(note, 'unpitched')) add('error', 'MISSING_PITCH', '음표에 음높이·쉼표·타악 음높이 정보가 없습니다.');
    return null;
  }
  if (exists(note, 'rest') || exists(note, 'unpitched')) add('error', 'PITCH_CONFLICT', '하나의 음표에 음높이와 쉼표·타악 정보가 함께 있습니다.');
  const step = value(pitch, 'step');
  const octave = number(value(pitch, 'octave'));
  const alter = exists(pitch, 'alter') ? number(value(pitch, 'alter')) : 0;
  const offsets: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  if (!Object.hasOwn(offsets, step) || octave === null || !Number.isInteger(octave) || alter === null) {
    add('error', 'INVALID_PITCH', '음높이의 음이름·옥타브·변화표 숫자를 읽을 수 없습니다.');
    return null;
  }
  const midi = (octave + 1) * 12 + offsets[step] + alter;
  return Number.isFinite(midi) ? midi : null;
}
function nominalDuration(note: XmlNode, add: AddIssue): number | null {
  let ratio = 1;
  const modification = first(note, 'time-modification');
  if (modification) {
    const actual = number(value(modification, 'actual-notes'));
    const normal = number(value(modification, 'normal-notes'));
    if (actual === null || normal === null || actual <= 0 || normal <= 0 || !Number.isInteger(actual) || !Number.isInteger(normal)) {
      add('error', 'INVALID_TUPLET_RATIO', '잇단음표의 actual-notes와 normal-notes는 양의 정수여야 합니다.');
      return null;
    }
    ratio = normal / actual;
  }
  const base = TYPE_BEATS[value(note, 'type')];
  if (base === undefined) return null;
  const dots = children(note, 'dot').length;
  const duration = base * (2 - 1 / 2 ** dots) * ratio;
  return Number.isFinite(duration) ? duration : null;
}
function chordPitch(node: XmlNode | undefined, prefix: 'root' | 'bass'): MusicXMLReviewChord['root'] {
  if (!node) return null;
  const step = value(node, prefix + '-step');
  const alter = exists(node, prefix + '-alter') ? number(value(node, prefix + '-alter')) : 0;
  return /^[A-G]$/.test(step) && alter !== null ? { step, alter } : null;
}

/**
 * Review the original partwise document without flattening it into the editor's
 * Score format. Checks internal timing consistency, never image transcription
 * accuracy. Semantic issues are returned; unsafe or malformed XML throws.
 */
export function analyzeMusicXML(xml: string): MusicXMLReview {
  const root = boundedXml(xml);
  const issues: MusicXMLReviewIssue[] = [{ severity: 'warning', code: 'SOURCE_COMPARISON_REQUIRED',
    message: '이 검사는 XML 내부의 시간·구조를 확인합니다. 음표·가사·코드가 원본 이미지와 같은지는 직접 대조해 주세요.' }];
  const partNames = new Map<string, string>();
  const partList = first(root, 'part-list');
  if (partList) for (const entry of children(partList, 'score-part')) partNames.set(entry.attrs.id, value(entry, 'part-name'));
  const parts: MusicXMLReviewPart[] = [];
  const lyricVerses: MusicXMLLyricVerse[] = [];
  const lyricBlocks: string[] = [];
  const seenPartIds = new Set<string>();
  for (const [partIndex, part] of children(root, 'part').entries()) {
    const partId = part.attrs.id || 'part-' + (partIndex + 1);
    if (seenPartIds.has(partId)) issues.push({ severity: 'error', code: 'DUPLICATE_PART_ID', partId, message: '파트 ID가 중복됩니다. 원본 XML의 파트 구분을 확인해 주세요.' });
    seenPartIds.add(partId);
    const measures: MusicXMLReviewMeasure[] = [];
    const voiceIds = new Set<string>();
    const meters = new Map<string, Meter>();
    const keys = new Map<string, string>();
    let divisions: number | null = null;
    let staffCount = 1;
    const streams = new Map<string, { verse: MusicXMLLyricVerse; lines: Map<number, MusicXMLReviewLyric[]> }>();
    for (const [measureIndex, measure] of children(part, 'measure').entries()) {
      const measureNumber = measure.attrs.number || String(measureIndex + 1);
      const add: AddIssue = (severity, code, message) => { issues.push({ severity, code, message, partId, measure: measureNumber }); };
      let cursor: number | null = 0;
      let extent = 0;
      let timingKnown = true;
      let midMeasureTimeChange = false;
      const divisionBoundaries: number[] = [];
      const events: MusicXMLReviewEvent[] = [];
      const chords: MusicXMLReviewChord[] = [];
      const changes: MusicXMLReviewChange[] = [];
      let anchor: MusicXMLReviewEvent | undefined;
      const voiceEnds = new Map<string, number>();
      const durationOf = (node: XmlNode): number | null => {
        const raw = number(value(node, 'duration'));
        if (raw === null || raw <= 0) { add('error', 'INVALID_DURATION', 'duration은 양의 숫자여야 합니다.'); return null; }
        if (divisions === null) { add('error', 'MISSING_DIVISIONS', 'duration을 계산할 divisions 값이 없습니다.'); return null; }
        const duration = raw / divisions;
        if (!Number.isFinite(duration)) { add('error', 'INVALID_DURATION', '음표 길이를 유한한 박 수로 계산할 수 없습니다.'); return null; }
        return duration;
      };
      for (const child of measure.children) {
        if (child.name === 'attributes') {
          if (exists(child, 'divisions')) {
            const next = number(value(child, 'divisions'));
            if (next === null || next <= 0) { divisions = null; add('error', 'INVALID_DIVISIONS', 'divisions는 양의 숫자여야 합니다.'); }
            else {
              if (cursor !== null && cursor > EPSILON && next !== divisions) divisionBoundaries.push(cursor);
              divisions = next;
              changes.push({ type: 'divisions', value: String(next), onsetQuarterBeats: cursor });
            }
          }
          if (exists(child, 'staves')) {
            const next = number(value(child, 'staves'));
            if (next === null || next < 1 || !Number.isInteger(next)) add('error', 'INVALID_STAFF_COUNT', 'staves는 양의 정수여야 합니다.');
            else staffCount = Math.max(staffCount, next);
          }
          for (const key of children(child, 'key')) {
            const staff = key.attrs.number || '*';
            const next = key.children.map(item => item.name + '=' + content(item).trim()).join(';');
            if (keys.has(staff) && keys.get(staff) !== next) add('warning', 'KEY_CHANGE', '이 마디에서 조표가 바뀝니다. 원본 조표를 대조해 주세요.');
            keys.set(staff, next);
            changes.push({ type: 'key', value: next, onsetQuarterBeats: cursor, ...(staff !== '*' ? { staff } : {}) });
          }
          for (const time of children(child, 'time')) {
            const staff = time.attrs.number || '*';
            const next = readMeter(time);
            if (!next) { add('error', 'INVALID_TIME_SIGNATURE', '박자 분자·분모를 읽을 수 없습니다.'); meters.delete(staff); continue; }
            const previous = meters.get(staff) ?? meters.get('*');
            if (previous && previous.signature !== next.signature) add('warning', 'TIME_CHANGE', '이 마디에서 박자가 바뀝니다. 원본 박자 표시를 대조해 주세요.');
            if (cursor !== null && cursor > EPSILON) { midMeasureTimeChange = true; add('warning', 'MID_MEASURE_TIME_CHANGE', '마디 안에서 박자가 바뀌어 한 가지 박자로 마디 길이를 판정하지 않았습니다.'); }
            meters.set(staff, next);
            changes.push({ type: 'time', value: next.signature, onsetQuarterBeats: cursor, ...(staff !== '*' ? { staff } : {}) });
          }
        } else if (child.name === 'note') {
          const grace = exists(child, 'grace');
          const isChord = exists(child, 'chord');
          const duration = grace ? 0 : durationOf(child);
          const voice = value(child, 'voice') || (isChord ? anchor?.voice : undefined) || '1';
          const staff = value(child, 'staff') || '1';
          voiceIds.add(voice);
          const numericStaff = number(staff);
          if (numericStaff !== null && numericStaff >= 1 && Number.isInteger(numericStaff)) staffCount = Math.max(staffCount, numericStaff);
          else add('error', 'INVALID_STAFF', '음표의 staff 값은 양의 정수여야 합니다.');
          const onset = isChord ? anchor?.onsetQuarterBeats ?? cursor : cursor;
          if (isChord && !anchor) add('error', 'CHORD_WITHOUT_BASE', 'chord 음표 앞에 기준 음표가 없습니다.');
          if (isChord && anchor && anchor.voice !== voice) add('error', 'CHORD_VOICE_MISMATCH', '화음의 기준 음표와 추가 음표의 성부가 다릅니다.');
          if (isChord && anchor?.durationQuarterBeats !== null && anchor?.durationQuarterBeats !== undefined && duration !== null && duration > anchor.durationQuarterBeats + EPSILON) add('error', 'CHORD_LONGER_THAN_BASE', '추가 화음 음표가 기준 음표보다 깁니다.');
          const ties = [...children(child, 'tie'), ...children(first(child, 'notations'), 'tied')];
          const event: MusicXMLReviewEvent = {
            index: events.length, pitchMidi: writtenPitch(child, add), rest: exists(child, 'rest'), unpitched: exists(child, 'unpitched'),
            grace, chord: isChord, durationQuarterBeats: duration, onsetQuarterBeats: onset,
            tieStart: ties.some(tie => tie.attrs.type === 'start' || tie.attrs.type === 'continue'),
            tieStop: ties.some(tie => tie.attrs.type === 'stop' || tie.attrs.type === 'continue'),
            voice, staff, lyrics: readLyrics(child),
          };
          events.push(event);
          if (!grace) {
            const nominal = nominalDuration(child, add);
            if (first(child, 'rest')?.attrs.measure !== 'yes' && nominal !== null && duration !== null && Math.abs(nominal - duration) > EPSILON) add('warning', 'NOTATED_DURATION_MISMATCH', '음표 종류·점·잇단음표 비율과 duration의 실제 길이가 다릅니다. 원본을 확인해 주세요.');
          }
          if (duration === null || onset === null) timingKnown = false;
          else {
            const end = onset + duration;
            if (!Number.isFinite(end)) { timingKnown = false; add('error', 'INVALID_TIMELINE', '음표의 누적 시간을 유한한 박 수로 계산할 수 없습니다.'); }
            else {
              extent = Math.max(extent, end);
              if (!isChord && !grace) {
                const previousEnd = voiceEnds.get(voice);
                if (previousEnd !== undefined && onset < previousEnd - EPSILON) add('error', 'VOICE_OVERLAP', '같은 성부의 비화음 음표 시간이 겹칩니다. 성부·backup·duration을 확인해 주세요.');
                voiceEnds.set(voice, Math.max(previousEnd ?? 0, end));
              }
            }
          }
          if (!isChord) {
            anchor = event;
            const nextCursor: number | null = cursor === null || duration === null ? null : cursor + duration;
            cursor = nextCursor !== null && Number.isFinite(nextCursor) ? nextCursor : null;
          }
          for (const lyric of event.lyrics) {
            if (!lyric.text && !lyric.extend && !lyric.endLine) continue;
            const streamKey = JSON.stringify([staff, voice, lyric.number]);
            let stream = streams.get(streamKey);
            if (!stream) {
              const verse: MusicXMLLyricVerse = { identifier: JSON.stringify([partIndex, partId, staff, voice, lyric.number]), partId, staff, voice,
                number: lyric.number, ...(lyric.name ? { name: lyric.name } : {}) };
              stream = { verse, lines: new Map() }; streams.set(streamKey, stream); lyricVerses.push(verse);
            }
            if (lyric.name && !stream.verse.name) stream.verse.name = lyric.name;
            const line = stream.lines.get(measureIndex) ?? [];
            line.push(lyric); stream.lines.set(measureIndex, line);
          }
        } else if (child.name === 'backup' || child.name === 'forward') {
          const duration = durationOf(child);
          anchor = undefined;
          if (duration === null || cursor === null) { timingKnown = false; cursor = null; continue; }
          const from: number = cursor;
          const next: number = from + (child.name === 'backup' ? -duration : duration);
          if (!Number.isFinite(next)) { timingKnown = false; cursor = null; add('error', 'INVALID_TIMELINE', 'backup・forward의 누적 시간을 유한한 박 수로 계산할 수 없습니다.'); continue; }
          if (next < -EPSILON) add('error', 'BACKUP_BEFORE_MEASURE', 'backup이 마디 시작보다 앞까지 이동합니다.');
          if (divisionBoundaries.some(boundary => Math.min(from, next) < boundary - EPSILON && Math.max(from, next) > boundary + EPSILON)) add('error', 'MOVE_CROSSES_DIVISIONS', 'backup·forward가 마디 안의 divisions 변경을 건너갑니다.');
          cursor = next;
          if (child.name === 'forward') extent = Math.max(extent, next);
        } else if (child.name === 'harmony') {
          const rawOffset = exists(child, 'offset') ? number(value(child, 'offset')) : 0;
          const offset = rawOffset === 0 ? 0 : rawOffset !== null && divisions !== null ? rawOffset / divisions : null;
          if (offset === null) add('error', 'INVALID_HARMONY_OFFSET', '코드의 offset과 divisions로 위치를 계산할 수 없습니다.');
          const kind = first(child, 'kind');
          chords.push({ index: chords.length, root: chordPitch(first(child, 'root'), 'root'), bass: chordPitch(first(child, 'bass'), 'bass'),
            kind: content(kind).trim(), kindText: kind?.attrs.text || '', offsetQuarterBeats: offset,
            onsetQuarterBeats: cursor !== null && offset !== null ? cursor + offset : null, staff: value(child, 'staff') || '1' });
          if (children(child, 'kind').length > 1) add('warning', 'STACKED_HARMONY', '여러 코드 구성요소가 있는 harmony입니다. 원문은 보존하며 요약에는 첫 근음·종류를 표시합니다.');
        }
      }
      // Work is bounded by XML nodes, never by an untrusted numeric staves value.
      const specificMeters = [...meters.entries()].filter(([staff]) => {
        const index = number(staff);
        return index !== null && Number.isInteger(index) && index >= 1 && index <= staffCount;
      }).map(([, meter]) => meter);
      const missingStaffMeters = staffCount > specificMeters.length && !meters.has('*');
      const relevant = [...specificMeters];
      if (staffCount > specificMeters.length && meters.has('*')) relevant.push(meters.get('*')!);
      let expected: number | null = relevant[0]?.quarters ?? null;
      if (!relevant.length) add('warning', 'MISSING_TIME_SIGNATURE', '박자 표시가 없어 마디 길이를 판정하지 않았습니다.');
      else if (relevant.some(meter => meter.quarters === null)) { expected = null; add('warning', 'NON_METRIC_MEASURE', '정해진 박자가 없는 마디입니다. 실제 음표 시간만 보존했습니다.'); }
      else if (missingStaffMeters || relevant.some(meter => Math.abs((meter.quarters ?? 0) - (expected ?? 0)) > EPSILON)) { expected = null; add('warning', 'MULTIMETRIC_MEASURE', '보표별 박자가 다르거나 일부 보표의 박자가 없어 한 가지 마디 길이로 판정하지 않았습니다.'); }
      if (midMeasureTimeChange || measure.attrs['non-controlling'] === 'yes') expected = null;
      const implicit = measure.attrs.implicit === 'yes';
      if (implicit) add('warning', 'IMPLICIT_MEASURE', 'implicit 마디입니다. 못갖춘마디·반복 분할 마디일 수 있어 짧은 길이를 누락으로 판정하지 않았습니다.');
      if (timingKnown && expected !== null) {
        if (extent > expected + EPSILON) add('error', 'MEASURE_OVERFULL', `마디 길이 ${extent}박이 박자에 필요한 ${expected}박보다 깁니다.`);
        else if (!implicit && extent < expected - EPSILON) add('warning', 'MEASURE_UNDERFULL', `마디 길이 ${extent}박이 박자에 필요한 ${expected}박보다 짧습니다. 못갖춘마디인지 음표 누락인지 원본을 확인해 주세요.`);
      }
      measures.push({ index: measureIndex, number: measureNumber, implicit, expectedQuarterBeats: expected,
        durationQuarterBeats: timingKnown ? extent : null, events, chords, changes });
    }
    const name = partNames.get(partId) || partId;
    parts.push({ id: partId, name, staffCount, voiceIds: [...voiceIds], measures });
    for (const { verse, lines } of streams.values()) {
      const heading = `[${name} (${partId}) · 보표 ${verse.staff} · 성부 ${verse.voice} · ${verse.name || verse.number + '절'}]`;
      lyricBlocks.push(heading + '\n' + lyricStreamText(lines));
    }
  }
  if (!parts.length) issues.push({ severity: 'error', code: 'NO_PARTS', message: 'MusicXML 문서에 part가 없습니다.' });
  if (parts.some(part => !part.measures.length)) issues.push({ severity: 'warning', code: 'EMPTY_PART', message: '마디가 없는 파트가 있습니다.' });
  const allMeasures = parts.flatMap(part => part.measures);
  return { version: 1, xml, title: value(root, 'movement-title') || value(first(root, 'work'), 'work-title') || '가져온 악보',
    partCount: parts.length, measureCount: parts.reduce((max, part) => Math.max(max, part.measures.length), 0), totalPartMeasures: allMeasures.length,
    noteCount: allMeasures.reduce((sum, measure) => sum + measure.events.length, 0), chordCount: allMeasures.reduce((sum, measure) => sum + measure.chords.length, 0),
    lyricVerses, lyricsText: lyricBlocks.join('\n\n'), parts, issues };
}
