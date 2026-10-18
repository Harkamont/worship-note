import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Unzip, UnzipInflate } from 'fflate';
import { durationBeats, KEY_OPTIONS, measureBeats, validateScore } from './music.ts';
import { createRestNotes } from './editor.ts';
import type { NoteDuration, NoteLyric, Score, ScoreChord, ScoreMeasure, ScoreNote } from './score-types.ts';

const MAX_XML = 2 * 1024 * 1024;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_EXPANDED = 8 * 1024 * 1024;
const TYPES: Record<string, NoteDuration> = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16' };
const NOTE_BEATS: Record<NoteDuration, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };
const CHORD_KINDS: Record<string, string> = { major: '', minor: 'm', dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7', diminished: 'dim', augmented: 'aug', 'half-diminished': 'm7b5', 'diminished-seventh': 'dim7', 'suspended-second': 'sus2', 'suspended-fourth': 'sus4', 'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'maj9', 'minor-ninth': 'm9', 'dominant-11th': '11', 'dominant-13th': '13' };
type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; value: string };
export interface MusicXMLImportOptions { reviewDraft?: boolean; }

function elements(node: XmlNode, name: string): XmlNode[] { return node.children.filter(child => child.name === name); }
function one(node: XmlNode, name: string): XmlNode | undefined {
  const found = elements(node, name);
  if (found.length > 1) throw new Error(name + ': XML 항목이 중복되어 있습니다.');
  return found[0];
}
function text(node?: XmlNode): string { return node ? node.value + node.children.map(child => text(child)).join('') : ''; }
function value(node: XmlNode, name: string): string { return text(one(node, name)).trim(); }
function numeric(raw: string, name: string): number {
  if (!raw || !/^-?\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) throw new Error(name + ': 숫자가 올바르지 않습니다.');
  return Number(raw);
}
function optionalNumber(node: XmlNode, name: string, fallback: number): number {
  return one(node, name) ? numeric(value(node, name), name) : fallback;
}

/** Strip declarations before parsing: no DTD or custom entity can be resolved. */
function parseXml(xml: string): XmlNode {
  if (new TextEncoder().encode(xml).byteLength > MAX_XML) throw new Error('XML 파일은 2MB 이하여야 합니다.');
  if (/<!ENTITY\b/i.test(xml) || /<!DOCTYPE[^>]*\[/i.test(xml)) throw new Error('XML 사용자 정의 엔터티와 내부 DTD 선언은 지원하지 않습니다.');
  const cleaned = xml.replace(/<!DOCTYPE[^>]*>/gi, '');
  const entitySource = cleaned.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  if (/&(?!(?:amp|lt|gt|apos|quot);|#\d+;|#x[\da-fA-F]+;)/.test(entitySource)) throw new Error('XML에 지원하지 않는 엔터티가 있습니다.');
  if (XMLValidator.validate(cleaned) !== true) throw new Error('XML 문법이 올바르지 않습니다.');
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false, trimValues: false, removeNSPrefix: true, ignoreDeclaration: true, ignorePiTags: true, processEntities: true });
  let count = 0;
  const convert = (entry: Record<string, unknown>, depth: number): XmlNode => {
    if (depth > 64 || ++count > 100_000) throw new Error('XML 구조가 너무 복잡합니다.');
    const name = Object.keys(entry).find(key => key !== ':@')!;
    const children = entry[name];
    const result: XmlNode = { name, attrs: (entry[':@'] ?? {}) as Record<string, string>, children: [], value: '' };
    if (Array.isArray(children)) for (const child of children as Record<string, unknown>[]) {
      if (Object.hasOwn(child, '#text')) result.value += String(child['#text']);
      else result.children.push(convert(child, depth + 1));
    }
    return result;
  };
  try {
    const parsed = parser.parse(cleaned) as Record<string, unknown>[];
    if (parsed.length !== 1) throw new Error('XML 최상위 항목이 하나여야 합니다.');
    return convert(parsed[0], 0);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('XML ')) throw error;
    throw new Error('XML 내용을 읽을 수 없습니다.');
  }
}

function pitchName(node: XmlNode, stepName: string, alterName: string): string {
  const step = value(node, stepName);
  const alter = optionalNumber(node, alterName, 0);
  if (!/^[A-G]$/.test(step) || ![-1, 0, 1].includes(alter)) throw new Error('음높이는 A~G와 반음 올림·내림만 지원합니다.');
  return step + (alter === 1 ? '#' : alter === -1 ? 'b' : '');
}

function readKey(node: XmlNode, warnings: Set<string>): string {
  const fifths = numeric(value(node, 'fifths'), '조표');
  const mode = value(node, 'mode') || 'major';
  if (!one(node, 'mode')) warnings.add('장조·단조 표시가 없어 장조로 가져왔습니다. 원본 조성을 확인해 주세요.');
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7 || !['major', 'minor'].includes(mode)) throw new Error('조성은 장조·단조와 조표 -7~7만 지원합니다.');
  return KEY_OPTIONS[mode as 'major' | 'minor'][fifths + 7];
}

function readTime(node: XmlNode): { signature: string; total: number } {
  const beats = numeric(value(node, 'beats'), '박자 분자');
  const unit = numeric(value(node, 'beat-type'), '박자 분모');
  if (!Number.isInteger(beats) || beats < 1 || beats > 12 || ![2, 4, 8, 16].includes(unit)) throw new Error('지원하지 않는 박자입니다.');
  return { signature: beats + '/' + unit, total: beats * 4 / unit };
}

function readNote(node: XmlNode, divisions: number, id: string, warnings: Set<string>, primaryLyricNumber?: string): ScoreNote {
  for (const [tag, message] of Object.entries({ chord: '동시에 울리는 여러 음', grace: '꾸밈음', 'time-modification': '잇단음표', unpitched: '음높이가 없는 타악 음표' })) if (one(node, tag)) throw new Error(message + ': 현재 가져오기에서 지원하지 않습니다.');
  const rest = one(node, 'rest');
  const pitch = one(node, 'pitch');
  if (Boolean(rest) === Boolean(pitch)) throw new Error('음표에는 음높이 또는 쉼표 하나가 필요합니다.');
  let dots = elements(node, 'dot').length;
  if (dots > 1) throw new Error('겹점 음표는 지원하지 않습니다.');
  const rawDuration = numeric(value(node, 'duration'), '음표 길이') / divisions;
  const fullRest = rest?.attrs.measure === 'yes';
  let duration: NoteDuration | undefined = TYPES[value(node, 'type')];
  if (!duration && fullRest) {
    for (const candidate of Object.values(TYPES)) {
      if (NOTE_BEATS[candidate] * (dots ? 1.5 : 1) === rawDuration) { duration = candidate; break; }
      if (!dots && NOTE_BEATS[candidate] * 1.5 === rawDuration) { duration = candidate; dots = 1; break; }
    }
  }
  if (!duration) throw new Error('온음표부터 16분음표까지만 지원합니다.');
  const lyricNodes = elements(node, 'lyric');
  const lyrics: NoteLyric[] = lyricNodes.map((lyric, index) => {
    const syllabics = elements(lyric, 'syllabic');
    const syllabic = text(syllabics[0]).trim();
    if (syllabic && !['single', 'begin', 'middle', 'end'].includes(syllabic)) throw new Error('가사 음절 구분(syllabic)이 올바르지 않습니다.');
    const extension = one(lyric, 'extend');
    const extend = extension ? extension.attrs.type || 'start' : undefined;
    if (extend && !['start', 'continue', 'stop'].includes(extend)) throw new Error('가사 늘임(extend) 종류가 올바르지 않습니다.');
    if (syllabics.length > 1 || elements(lyric, 'elision').length) warnings.add('한 음표 안의 연결 가사(elision)는 문자열로 합쳤습니다. 세부 음절 구분과 원본의 단어 구분을 확인해 주세요.');
    if (lyric.children.some(child => !['text', 'elision', 'syllabic', 'extend', 'end-line'].includes(child.name))) warnings.add('일부 가사 기호·문단 구분은 편집기에서 보존하지 않습니다. 원본 가사 표시를 확인해 주세요.');
    if (lyric.attrs['time-only']) warnings.add('가사의 반복 회차(time-only)는 송폼에 반영하지 않았습니다. 절 선택과 반복 순서를 확인해 주세요.');
    return {
      number: lyric.attrs.number || String(index + 1),
      text: lyric.children.filter(child => ['text', 'elision'].includes(child.name)).map(child => text(child)).join(''),
      ...(syllabic ? { syllabic: syllabic as NoteLyric['syllabic'] } : {}),
      ...(extend ? { extend: extend as NoteLyric['extend'] } : {}),
      ...(one(lyric, 'end-line') ? { endLine: true } : {}),
    };
  });
  if (primaryLyricNumber && !lyrics.some(lyric => lyric.number === primaryLyricNumber)) lyrics.unshift({ number: primaryLyricNumber, text: '' });
  const primaryLyric = lyrics.find(lyric => lyric.number === primaryLyricNumber);
  const notations = one(node, 'notations');
  if (notations && elements(notations, 'slur').length) warnings.add('이음줄은 편집기에서 지원하지 않아 표시하지 않습니다. 음표의 붙임줄과 구분해 원본을 확인해 주세요.');
  if (notations?.children.some(child => !['tied', 'slur'].includes(child.name))) warnings.add('일부 장식·연주 기호는 편집기에서 표시하지 않습니다. 원본에서 확인해 주세요.');
  const ties = [...elements(node, 'tie'), ...(notations ? elements(notations, 'tied') : [])];
  if (ties.some(tie => !['start', 'stop'].includes(tie.attrs.type))) throw new Error('지원하지 않는 붙임줄 종류입니다.');
  const result: ScoreNote = { id, pitch: pitch ? pitchName(pitch, 'step', 'alter') + value(pitch, 'octave') : null, duration, dots: dots as 0 | 1, tie: ties.some(tie => tie.attrs.type === 'start'), lyric: primaryLyric?.text ?? '', ...(lyrics.length ? { lyrics } : {}) };
  if (Math.abs(durationBeats(result) - rawDuration) > 0.000001) throw new Error('음표 종류와 실제 음표 길이가 일치하지 않습니다.');
  return result;
}

function chordPitch(node: XmlNode, element: 'root' | 'bass'): string {
  const pitch = pitchName(node, element + '-step', element + '-alter');
  const display = one(node, element + '-step')?.attrs.text;
  if (display === undefined) return pitch;
  const match = /^(\(?)([A-G][#b]?)(\)?)$/.exec(display.trim().replace(/♯/g, '#').replace(/♭/g, 'b'));
  if (!match || ![value(node, element + '-step'), pitch].includes(match[2])) throw new Error('코드 근음·베이스의 표시 문자를 보존할 수 없습니다.');
  return match[1] + pitch + match[3];
}

function chordDegreeSuffix(node: XmlNode, kind: XmlNode, suffix: string): string {
  const degrees = elements(node, 'degree');
  if (!degrees.length) return suffix;
  if (degrees.length !== 1) throw new Error('여러 코드 추가음(degree)은 현재 가져오기에서 지원하지 않습니다.');
  const degree = degrees[0];
  const number = numeric(value(degree, 'degree-value'), '코드 추가음(degree-value)');
  const alter = numeric(value(degree, 'degree-alter'), '코드 추가음(degree-alter)');
  const base = CHORD_KINDS[text(kind).trim()];
  if (value(degree, 'degree-type') !== 'add' || ![2, 9].includes(number) || ![-1, 0, 1].includes(alter) || base === undefined) throw new Error('코드 추가음(degree)은 add2·add9와 반음 올림·내림만 지원합니다. alter·subtract는 지원하지 않습니다.');
  const tone = (alter === 1 ? '#' : alter === -1 ? 'b' : '') + number;
  const aliases: Record<string, string[]> = { '': ['M', 'maj'], m: ['min'], maj7: ['M7'], m7: ['min7'], m7b5: ['ø7'], dim: ['°'], dim7: ['°7'], aug: ['+'] };
  const bases = [base, ...(aliases[base] ?? [])];
  if (bases.includes(suffix)) return suffix + 'add' + tone;
  if (!bases.some(base => [base + 'add' + tone, base + '(add' + tone + ')', base + '(' + tone + ')'].includes(suffix))) throw new Error('코드 표시와 추가음(degree)이 일치하지 않아 보존할 수 없습니다.');
  return suffix;
}

function readChord(node: XmlNode, divisions: number, position: number, id: string): ScoreChord {
  const kind = one(node, 'kind');
  if (!kind || elements(node, 'root').length > 1 || one(node, 'function') || one(node, 'numeral')) throw new Error('지원하지 않는 코드 구성입니다.');
  if (text(kind).trim() === 'none') {
    if (elements(node, 'degree').length) throw new Error('코드 없음 표시에 추가음(degree)을 적용할 수 없습니다.');
    return { id, beat: position + optionalNumber(node, 'offset', 0) / divisions + 1, symbol: 'N.C.' };
  }
  const root = one(node, 'root');
  if (!root) throw new Error('코드의 근음이 없습니다.');
  const suffix = kind.attrs.text?.trim() || CHORD_KINDS[text(kind).trim()];
  if (suffix === undefined) throw new Error('지원하지 않는 코드 종류입니다.');
  const bass = one(node, 'bass');
  const rootText = chordPitch(root, 'root');
  const closesAtKind = rootText.startsWith('(') && !bass && suffix.endsWith(')');
  const degreeSuffix = chordDegreeSuffix(node, kind, closesAtKind ? suffix.slice(0, -1) : suffix);
  return { id, beat: position + optionalNumber(node, 'offset', 0) / divisions + 1, symbol: rootText + degreeSuffix + (closesAtKind ? ')' : '') + (bass ? '/' + chordPitch(bass, 'bass') : '') };
}

function readTempo(node: XmlNode): number | undefined {
  const sound = node.name === 'sound' ? node : one(node, 'sound');
  if (sound?.attrs.tempo) return numeric(sound.attrs.tempo, '빠르기');
  const metronomes = elements(node, 'direction-type').flatMap(direction => elements(direction, 'metronome'));
  if (!metronomes.length) return undefined;
  if (metronomes.length !== 1) throw new Error('빠르기 표시가 여러 개입니다.');
  const metronome = metronomes[0];
  const unit = TYPES[value(metronome, 'beat-unit')];
  const dots = elements(metronome, 'beat-unit-dot').length;
  if (!unit || dots > 1) throw new Error('지원하지 않는 빠르기 표시입니다.');
  return numeric(value(metronome, 'per-minute'), '빠르기') * NOTE_BEATS[unit] * (dots ? 1.5 : 1);
}

/** Import one part, staff and voice, retaining first or explicitly implicit short measures. */
export function parseMusicXML(xml: string, options: MusicXMLImportOptions = {}): Score {
  const root = parseXml(xml);
  if (root.name !== 'score-partwise') throw new Error('파트별 MusicXML(score-partwise) 파일만 지원합니다.');
  const parts = elements(root, 'part');
  if (parts.length !== 1 || (one(root, 'part-list') && elements(one(root, 'part-list')!, 'score-part').length !== 1)) throw new Error('멜로디 파트가 하나인 악보만 지원합니다.');
  const measureNodes = elements(parts[0], 'measure');
  if (!measureNodes.length || measureNodes.length > 128) throw new Error('MusicXML은 1~128마디까지 가져올 수 있습니다.');
  const lyricNumbers = measureNodes.flatMap(measure => elements(measure, 'note').flatMap(note => elements(note, 'lyric').map((lyric, index) => lyric.attrs.number || String(index + 1))));
  const primaryLyricNumber = lyricNumbers.includes('1') ? '1' : lyricNumbers[0];
  const warnings = new Set<string>(['MusicXML의 음표·코드·가사는 원본 이미지와 대조해 확인한 결과가 아닙니다. 인식 오류를 확인해 주세요.', '구간과 송폼은 자동으로 판단하지 않습니다. 전체 악보를 ‘전체’ 구간으로 한 번 연주하도록 가져왔습니다.']);
  const issues: string[] = [];
  const measures: ScoreMeasure[] = [];
  const voices = new Set<string>();
  let divisions = 0;
  let key = '';
  let time: ReturnType<typeof readTime> | undefined;
  let tempo: number | undefined;
  let previousNote: ScoreNote | undefined;
  for (const [index, measure] of measureNodes.entries()) {
    const notes: ScoreNote[] = [];
    const chords: ScoreChord[] = [];
    let position = 0;
    let reviewExpectedBeats: number | undefined;
    const issue = (message: string) => issues.push((index + 1) + '마디: ' + message);
    for (const child of measure.children) try {
      if (child.name === 'attributes') {
        if (one(child, 'divisions')) {
          divisions = numeric(value(child, 'divisions'), '음표 길이 기준');
          if (!Number.isInteger(divisions) || divisions <= 0 || divisions > 1_000_000) throw new Error('음표 길이 기준(divisions)은 양의 정수여야 합니다.');
        }
        if (one(child, 'staves') && value(child, 'staves') !== '1') throw new Error('보표 하나만 지원합니다.');
        if (elements(child, 'clef').length > 1 || elements(child, 'key').length > 1 || elements(child, 'time').length > 1 || one(child, 'transpose')) throw new Error('여러 보표 또는 이조 악기는 지원하지 않습니다.');
        const clef = one(child, 'clef');
        if (clef && (value(clef, 'sign') !== 'G' || value(clef, 'line') !== '2' || optionalNumber(clef, 'clef-octave-change', 0) !== 0)) warnings.add('원본의 음자리표는 높은음자리표와 다릅니다. 음높이는 보존하고 편집기에서는 높은음자리표로 표시합니다.');
        const newKey = one(child, 'key') ? readKey(one(child, 'key')!, warnings) : undefined;
        if (newKey && key && newKey !== key) {
          if (options.reviewDraft !== true) throw new Error('곡 중간의 조성 변경은 지원하지 않습니다.');
          warnings.add((index + 1) + '마디: 원본 조표 ' + newKey + ' 대신 첫 조표 ' + key + '로 표시합니다. 음높이와 반음 올림·내림(alter)은 원본 값대로 보존했습니다.');
        } else key = newKey || key;
        const newTime = one(child, 'time') ? readTime(one(child, 'time')!) : undefined;
        if (newTime && time && newTime.signature !== time.signature) throw new Error('곡 중간의 박자 변경은 지원하지 않습니다.');
        time = newTime || time;
      } else if (child.name === 'note') {
        if (!divisions || !time) throw new Error('첫 음표 앞에 divisions와 박자 표시가 필요합니다.');
        if (one(child, 'staff') && value(child, 'staff') !== '1') throw new Error('보표 하나만 지원합니다.');
        const voice = value(child, 'voice') || '1';
        const anotherVoice = voices.size > 0 && !voices.has(voice);
        voices.add(voice);
        if (anotherVoice) throw new Error('성부 하나만 지원합니다.');
        const note = readNote(child, divisions, 'xml-note-' + index + '-' + notes.length, warnings, primaryLyricNumber);
        const notations = one(child, 'notations');
        const stops = [...elements(child, 'tie'), ...(notations ? elements(notations, 'tied') : [])].some(tie => tie.attrs.type === 'stop');
        if (stops && !previousNote?.tie) throw new Error('앞 음표에서 시작하지 않은 붙임줄 끝이 있습니다.');
        if (previousNote?.tie && !stops) throw new Error('앞 음표의 붙임줄에 대응하는 끝 표시가 없습니다.');
        notes.push(note);
        position += durationBeats(note);
        previousNote = note;
      } else if (child.name === 'harmony') {
        if (!divisions) throw new Error('코드 앞에 divisions 표시가 필요합니다.');
        chords.push(readChord(child, divisions, position, 'xml-chord-' + index + '-' + chords.length));
      } else if (child.name === 'direction' || child.name === 'sound') {
        for (const words of elements(child, 'direction-type').flatMap(type => elements(type, 'words'))) {
          const marker = words.attrs.id;
          if (!marker?.startsWith('chanyang-review-')) continue;
          const match = /^chanyang-review-m\d+-beats-(\d+(?:\.\d+)?)$/.exec(marker);
          if (!match || reviewExpectedBeats !== undefined || !time) throw new Error('리듬 검토용 마디 길이 표시가 올바르지 않습니다.');
          reviewExpectedBeats = measureBeats({ actualBeats: Number(match[1]) }, time.signature);
        }
        const next = readTempo(child);
        if (next !== undefined) {
          if (tempo !== undefined && tempo !== next) throw new Error('곡 중간의 빠르기 변경은 지원하지 않습니다.');
          tempo = next;
        }
      } else if (child.name === 'forward' && options.reviewDraft === true) {
        if (!divisions || !time) throw new Error('빈 시간(forward) 앞에 divisions와 박자 표시가 필요합니다.');
        if (previousNote?.tie) throw new Error('붙임줄 사이에 빈 시간(forward)을 넣을 수 없습니다.');
        if (one(child, 'staff') && value(child, 'staff') !== '1') throw new Error('보표 하나만 지원합니다.');
        const voice = value(child, 'voice');
        if (voice && voices.size && !voices.has(voice)) throw new Error('성부 하나만 지원합니다.');
        if (voice) voices.add(voice);
        const beats = numeric(value(child, 'duration'), '빈 시간(forward) 길이') / divisions;
        const rests = createRestNotes(beats);
        for (const rest of rests) { rest.id = 'xml-note-' + index + '-' + notes.length; notes.push(rest); }
        position += beats;
        previousNote = rests.at(-1);
        warnings.add((index + 1) + '마디: 빈 시간(forward) ' + beats + '박을 쉼표 ' + rests.length + '개로 가져왔습니다. 뒤 음표의 시작 시각을 보존했습니다.');
      } else if (['backup', 'forward'].includes(child.name)) throw new Error('되감기(backup)와 빈 시간(forward)이 있는 다성부 악보는 지원하지 않습니다.');
      else if (child.name === 'barline') {
        if (one(child, 'repeat') || one(child, 'ending')) warnings.add('반복 기호와 반복 끝 구분은 송폼에 반영하지 않았습니다. 원본의 연주 순서를 직접 지정해 주세요.');
      } else if (!['print', 'grouping', 'link', 'bookmark'].includes(child.name)) throw new Error('지원하지 않는 마디 항목: ' + child.name);
    } catch (error) { issue(error instanceof Error ? error.message : '내용을 읽을 수 없습니다.'); }
    const inferredShort = time && reviewExpectedBeats === undefined && position > 0 && position < time.total && ((index === 0 && measure.attrs.implicit !== 'no') || measure.attrs.implicit === 'yes');
    if (inferredShort && index === 0 && measure.attrs.implicit !== 'yes') warnings.add('첫 마디의 음표 길이가 박자보다 짧아 ' + position + '박의 못갖춘마디로 가져왔습니다. 원본의 마디 길이를 확인해 주세요.');
    const expectedBeats = reviewExpectedBeats ?? (inferredShort ? position : time?.total);
    const shortened = time && expectedBeats !== undefined && expectedBeats < time.total;
    const mismatch = expectedBeats !== undefined && Math.abs(position - expectedBeats) > 0.000001;
    const invalidChords = expectedBeats === undefined ? [] : chords.filter(chord => chord.beat >= expectedBeats + 1);
    if (mismatch) {
      if (options.reviewDraft === true) warnings.add((index + 1) + '마디: 음표 길이 합 ' + position + '박 / 마디 길이 ' + expectedBeats + '박. 원본을 보고 음표 길이와 쉼표를 수정해 주세요.');
      else issue('음표 길이 합 ' + position + '박이 박자에 필요한 ' + expectedBeats + '박과 다릅니다.');
    }
    if (invalidChords.length) {
      const message = '마디 길이를 벗어난 코드 박 위치: ' + invalidChords.map(chord => chord.beat).join(', ') + '. 원본을 보고 코드 위치를 수정해 주세요.';
      if (options.reviewDraft === true) warnings.add((index + 1) + '마디: ' + message);
      else issue(message);
    }
    measures.push({ id: 'xml-measure-' + index, notes, chords, ...(shortened ? { actualBeats: expectedBeats } : {}), ...((mismatch || invalidChords.length > 0) && options.reviewDraft === true ? { rhythmReview: true as const } : {}) });
  }
  if (issues.length) throw new Error('MusicXML을 가져오지 못했습니다.\n' + issues.join('\n'));
  if (!key || !time) throw new Error('첫 마디에 조표와 박자 표시가 필요합니다.');
  if (tempo === undefined) warnings.add('빠르기 표시가 없어 80 BPM으로 가져왔습니다. 원본 빠르기를 확인해 주세요.');
  const identification = one(root, 'identification');
  const composer = identification ? elements(identification, 'creator').find(creator => creator.attrs.type === 'composer') : undefined;
  const sectionId = 'xml-section';
  const importWarnings = [...warnings];
  const boundedWarnings = importWarnings.length > 100 ? [...importWarnings.slice(0, 99), '참고사항 ' + (importWarnings.length - 99) + '개를 생략했습니다. 각 마디의 검토 표시는 모두 유지했습니다.'] : importWarnings;
  return validateScore({ version: 1, title: value(root, 'movement-title') || (one(root, 'work') ? value(one(root, 'work')!, 'work-title') : '') || '가져온 악보', artist: text(composer).trim(), key, timeSignature: time.signature, tempo: tempo ?? 80, source: 'manual', sections: [{ id: sectionId, label: '전체', type: 'verse', measures }], form: [{ id: 'xml-form', sectionId, repeat: 1 }], warnings: boundedWarnings });
}

function safePath(path: string): boolean {
  return !!path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => part === '..' || part === '.') && !/[\u0000-\u001f:]/.test(path);
}
function decodeXml(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_XML) throw new Error('XML 파일은 2MB 이하여야 합니다.');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('UTF-8로 저장한 MusicXML 파일을 사용해 주세요.'); }
}

/** Read MXL entirely in memory, with both declared and actual expansion limits. */
export async function readMusicXMLFile(bytes: Uint8Array, filename: string): Promise<string> {
  if (bytes.byteLength > MAX_FILE) throw new Error('악보 파일은 10MB 이하여야 합니다.');
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'xml' || extension === 'musicxml') return decodeXml(bytes);
  if (extension !== 'mxl') throw new Error('MusicXML 파일 확장자는 .xml, .musicxml, .mxl만 지원합니다.');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('MXL 압축 파일 형식이 올바르지 않습니다.');
  const files = new Map<string, Uint8Array>();
  const names = new Set<string>();
  let expanded = 0;
  let declared = 0;
  let completed = 0;
  let extractionLimitError: Error | undefined;
  const unzip = new Unzip(file => {
    if (!safePath(file.name) || names.has(file.name) || names.size >= 100) throw new Error('MXL 내부 파일 이름 또는 파일 수가 올바르지 않습니다.');
    names.add(file.name);
    declared += file.originalSize ?? 0;
    if (declared > MAX_EXPANDED) throw new Error('MXL 압축 해제 후 전체 크기는 8MB 이하여야 합니다.');
    if (file.name.endsWith('/') && (file.originalSize ?? 0) === 0) { completed++; return; }
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, data, final) => {
      if (error) throw extractionLimitError ?? new Error('MXL 압축을 해제할 수 없습니다.');
      size += data.byteLength;
      expanded += data.byteLength;
      if (expanded > MAX_EXPANDED || (file.name.toLowerCase().endsWith('.xml') && size > MAX_XML)) {
        file.terminate();
        extractionLimitError = new Error('MXL 압축 해제 크기 제한을 초과했습니다. XML은 2MB, 전체 파일은 8MB 이하여야 합니다.');
        throw extractionLimitError;
      }
      chunks.push(data);
      if (final) {
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
        files.set(file.name, result);
        completed++;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small compressed chunks also bound an inflater allocation before its size check.
  for (let offset = 0; offset < bytes.byteLength; offset += 1024) unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.byteLength);
  if (completed !== names.size) throw new Error('MXL 내부 파일이 완전하지 않습니다.');
  const manifest = files.get('META-INF/container.xml');
  if (!manifest) throw new Error('MXL에 META-INF/container.xml이 없습니다.');
  const container = parseXml(decodeXml(manifest).replace(/^\uFEFF/, ''));
  const rootfiles = one(container, 'rootfiles');
  const choices = rootfiles ? elements(rootfiles, 'rootfile').filter(file => file.attrs['media-type'] === 'application/vnd.recordare.musicxml+xml') : [];
  if (container.name !== 'container' || choices.length !== 1) throw new Error('MXL에 MusicXML 원본 파일 하나가 지정되어야 합니다.');
  const path = choices[0].attrs['full-path'];
  const source = safePath(path) ? files.get(path) : undefined;
  if (!source) throw new Error('MXL에 지정된 MusicXML 원본 파일을 찾을 수 없습니다.');
  return decodeXml(source);
}

/** Strict editor import and source review share the same bounded unpacker. */
export async function parseMusicXMLFile(bytes: Uint8Array, filename: string, options: MusicXMLImportOptions = {}): Promise<Score> {
  return parseMusicXML((await readMusicXMLFile(bytes, filename)).replace(/^\uFEFF/, ''), options);
}
