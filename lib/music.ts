import { getNoteLyrics, lyricVerseNumbers, sectionLyricText } from './lyrics.ts';
import type { ExportLyricsOptions, NoteLyric, NoteDuration, Score, ScoreChord, ScoreMeasure, ScoreNote, ScoreSection, SectionType } from './score-types.ts';

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURALS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const BEATS: Record<NoteDuration, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };
const MAX_REVIEW_BEATS = 64 * 6;
const SECTION_TYPES: SectionType[] = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'interlude', 'outro'];
const FIFTHS: Record<string, number> = { Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7 };
const MINOR_FIFTHS: Record<string, number> = { Ab: -7, Eb: -6, Bb: -5, F: -4, C: -3, G: -2, D: -1, A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7 };
export const KEY_OPTIONS = {
  major: Object.keys(FIFTHS),
  minor: Object.keys(MINOR_FIFTHS).map((root) => root + 'm'),
};

function accidentalText(value: string): string { return value.replace(/♭/g, 'b').replace(/♯/g, '#'); }
function modulo(value: number): number { return ((value % 12) + 12) % 12; }
function pitchClass(root: string): number { return modulo(NATURALS[root[0]] + (root[1] === '#' ? 1 : root[1] === 'b' ? -1 : 0)); }
function semitoneCount(value: number): void {
  if (!Number.isInteger(value) || Math.abs(value) > 127) throw new Error('조옮김 반음 수는 -127~127의 정수여야 합니다.');
}
function keyInfo(value: string): { root: string; minor: boolean; fifths: number } {
  const match = /^([A-G])([#b]?)(m|\s+minor|\s+major)?$/.exec(accidentalText(value.trim()));
  if (!match) throw new Error('지원하지 않는 조성입니다. C, Bb, F#m 같은 조성을 입력해 주세요.');
  const root = match[1] + match[2];
  const minor = match[3]?.trim() === 'm' || match[3]?.trim() === 'minor';
  const fifths = (minor ? MINOR_FIFTHS : FIFTHS)[root];
  if (fifths === undefined) throw new Error('조표는 플랫 7개부터 샤프 7개까지 지원합니다.');
  return { root, minor, fifths };
}
function parsePitch(value: string): { root: string; midi: number; octave: number } {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(accidentalText(value));
  if (!match) throw new Error('음높이는 C4, F#4, Bb3 형식이어야 합니다.');
  const root = match[1] + match[2];
  const octave = Number(match[3]);
  const midi = (octave + 1) * 12 + NATURALS[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  if (midi < 0 || midi > 127) throw new Error('음높이는 MIDI 0~127 범위여야 합니다.');
  return { root, midi, octave };
}
function validChordSuffix(suffix: string): boolean {
  let position = 0;
  let parentheses = false;
  let opening = -1;
  while (position < suffix.length) {
    const token = /^(?:maj|min|dim|aug|sus|add|omit|no|[#b]?\d+|[mM°øΔ+\-])/.exec(suffix.slice(position));
    if (token) { position += token[0].length; continue; }
    const character = suffix[position];
    if (character === '(' && !parentheses) { parentheses = true; opening = position; }
    else if (character === ')' && parentheses && position > opening + 1) parentheses = false;
    else if ((character === ',' || character === ' ') && parentheses) { /* chord degree separator */ }
    else return false;
    position++;
  }
  return !parentheses;
}
function parseChord(symbol: string): { root: string; suffix: string; bass?: string; parenthesized: boolean } | null {
  if (symbol.length > 40) throw new Error('코드 기호는 40자 이하여야 합니다.');
  const normalized = accidentalText(symbol.trim());
  if (/^(?:N\.?C\.?|NC)$/i.test(normalized)) return null;
  const parenthesized = normalized.startsWith('(') && normalized.endsWith(')');
  const core = parenthesized ? normalized.slice(1, -1) : normalized;
  const match = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(core);
  if (!match || !validChordSuffix(match[3])) {
    throw new Error('지원하지 않는 코드 기호입니다. C, F#m7b5, C/E 형식을 사용해 주세요.');
  }
  return { root: match[1] + match[2], suffix: match[3], bass: match[4] ? match[4] + match[5] : undefined, parenthesized };
}

export function durationBeats(note: Pick<ScoreNote, 'duration' | 'dots'>): number {
  const base = BEATS[note.duration];
  if (base === undefined || (note.dots !== 0 && note.dots !== 1)) throw new Error('지원하지 않는 음표 길이입니다.');
  return base * (note.dots ? 1.5 : 1);
}

export function transposePitch(pitch: string, semitones: number, preferFlats = false): string {
  semitoneCount(semitones);
  const moved = parsePitch(pitch).midi + semitones;
  if (moved < 0 || moved > 127) throw new Error('조옮김한 음높이가 지원 범위를 벗어납니다.');
  return (preferFlats ? FLATS : SHARPS)[modulo(moved)] + (Math.floor(moved / 12) - 1);
}

export function transposeChord(symbol: string, semitones: number, preferFlats = false): string {
  semitoneCount(semitones);
  const chord = parseChord(symbol);
  if (!chord) return symbol;
  const names = preferFlats ? FLATS : SHARPS;
  const moved = names[modulo(pitchClass(chord.root) + semitones)] + chord.suffix + (chord.bass ? '/' + names[modulo(pitchClass(chord.bass) + semitones)] : '');
  return chord.parenthesized ? '(' + moved + ')' : moved;
}

export function transposeScore(score: Score, targetKey: string): Score {
  const from = keyInfo(score.key);
  const to = keyInfo(targetKey);
  if (from.minor !== to.minor) throw new Error('장조·단조를 바꾸지 않고 같은 조성 종류로 조옮김해 주세요.');
  let semitones = modulo(pitchClass(to.root) - pitchClass(from.root));
  if (semitones > 6) semitones -= 12;
  const result = structuredClone(score);
  result.key = to.root + (to.minor ? 'm' : '');
  for (const section of result.sections) for (const measure of section.measures) {
    for (const note of measure.notes) if (note.pitch !== null) note.pitch = transposePitch(note.pitch, semitones, to.fifths < 0);
    for (const chord of measure.chords) chord.symbol = transposeChord(chord.symbol, semitones, to.fifths < 0);
  }
  return result;
}

export function sectionLyrics(section: ScoreSection, verse?: string): string {
  return sectionLyricText(section, verse);
}

function playedSections(score: Score): ScoreSection[] {
  const sections = new Map(score.sections.map((section) => [section.id, section]));
  if (!score.form.length) return score.sections;
  return score.form.flatMap((entry) => {
    const section = sections.get(entry.sectionId);
    if (!section) throw new Error('곡 순서가 존재하지 않는 구간을 참조합니다.');
    return Array.from({ length: entry.repeat }, () => section);
  });
}

export function exportLyrics(score: Score, options: ExportLyricsOptions = {}): string {
  const { sectionNames = true, includeInstrumentals = false, verse } = options;
  const sections = playedSections(score);
  const render = (number?: string) => sections.flatMap(section => {
    const lyrics = sectionLyrics(section, number);
    if (!lyrics && !includeInstrumentals) return [];
    return [(sectionNames ? '[' + section.label + ']\n' : '') + (lyrics || '(연주)')];
  }).join('\n\n');
  if (verse !== 'all') return render(verse);
  const verses = lyricVerseNumbers(sections);
  if (!verses.length) return render();
  return verses.flatMap(number => {
    const lyrics = render(number);
    return lyrics ? ['[가사 ' + number + ']\n' + lyrics] : [];
  }).join('\n\n');
}

export function getScoreStats(score: Score): { measures: number; notes: number; sections: number } {
  return {
    sections: score.sections.length,
    measures: score.sections.reduce((sum, section) => sum + section.measures.length, 0),
    notes: score.sections.reduce((sum, section) => sum + section.measures.reduce((count, measure) => count + measure.notes.length, 0), 0),
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(name + ': 객체가 필요합니다.');
  return value as Record<string, unknown>;
}
function stringValue(value: unknown, name: string, max: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(name + ': 문자열 길이 또는 형식이 올바르지 않습니다.');
  return value;
}
function numberValue(value: unknown, name: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(name + ': 숫자 범위 또는 형식이 올바르지 않습니다.');
  return value;
}
function arrayValue(value: unknown, name: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(name + ': 항목 수가 올바르지 않습니다.');
  return value;
}
function timeInfo(value: string): { beats: number; beatType: number; total: number } {
  const match = /^(\d{1,2})\/(2|4|8|16)$/.exec(value);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) throw new Error('박자는 1~12 / 2·4·8·16 형식이어야 합니다.');
  return { beats: Number(match[1]), beatType: Number(match[2]), total: Number(match[1]) * 4 / Number(match[2]) };
}

/** The measure's actual duration, in quarter-note beats; older scores use the meter. */
export function measureBeats(measure: Pick<ScoreMeasure, 'actualBeats'>, timeSignature: string): number {
  const total = timeInfo(timeSignature).total;
  if (measure.actualBeats === undefined) return total;
  const actual = numberValue(measure.actualBeats, '마디 실제 길이', Number.EPSILON, total);
  if (!Number.isInteger(actual * 8)) throw new Error('마디 실제 길이는 0.125박 단위여야 합니다.');
  return actual;
}

/** Validate at the import boundary and return only the supported, bounded fields. */
export function validateScore(input: unknown): Score {
  const raw = record(input, '악보');
  if (raw.version !== 1) throw new Error('악보 버전은 1이어야 합니다.');
  const title = stringValue(raw.title, '제목', 200, false);
  const artist = stringValue(raw.artist, '작곡·아티스트', 200);
  const parsedKey = keyInfo(stringValue(raw.key, '조성', 20, false));
  const key = parsedKey.root + (parsedKey.minor ? 'm' : '');
  const timeSignature = stringValue(raw.timeSignature, '박자', 8, false);
  timeInfo(timeSignature);
  const tempo = numberValue(raw.tempo, '빠르기', 20, 300, true);
  if (!['sample', 'manual', 'ai'].includes(raw.source as string)) throw new Error('악보 출처가 올바르지 않습니다.');
  const usedIds = new Set<string>();
  const id = (value: unknown): string => {
    const valueId = stringValue(value, '항목 ID', 80, false);
    if (usedIds.has(valueId)) throw new Error('중복된 항목 ID가 있습니다.');
    usedIds.add(valueId);
    return valueId;
  };
  let measureCount = 0;
  const sections: ScoreSection[] = arrayValue(raw.sections, '구간', 32, 1).map((sectionInput) => {
    const section = record(sectionInput, '구간');
    const sectionId = id(section.id);
    const label = stringValue(section.label, '구간 이름', 60, false);
    if (!SECTION_TYPES.includes(section.type as SectionType)) throw new Error('구간 종류가 올바르지 않습니다.');
    const measures = arrayValue(section.measures, '마디', 128, 1).map((measureInput) => {
      if (++measureCount > 512) throw new Error('전체 마디는 512개 이하여야 합니다.');
      const measure = record(measureInput, '마디');
      const measureId = id(measure.id);
      const actualBeats = measureBeats({ actualBeats: measure.actualBeats as number | undefined }, timeSignature);
      if (measure.rhythmReview !== undefined && measure.rhythmReview !== true) throw new Error('리듬 검토 표시는 true여야 합니다.');
      const notes: ScoreNote[] = arrayValue(measure.notes, '음표', 64, measure.rhythmReview === true ? 0 : 1).map((noteInput) => {
        const note = record(noteInput, '음표');
        const noteId = id(note.id);
        const pitch = note.pitch === null ? null : stringValue(note.pitch, '음높이', 5, false);
        if (pitch !== null) parsePitch(pitch);
        if (!Object.hasOwn(BEATS, note.duration as string)) throw new Error('음표 길이가 올바르지 않습니다.');
        if (note.dots !== 0 && note.dots !== 1) throw new Error('점은 0 또는 1이어야 합니다.');
        if (typeof note.tie !== 'boolean' || (pitch === null && note.tie)) throw new Error('붙임줄 값이 올바르지 않습니다.');
        const lyric = stringValue(note.lyric, '가사', 120);
        if (/[\r\n]/.test(lyric)) throw new Error('음표 가사는 한 줄이어야 합니다.');
        const result: ScoreNote = { id: noteId, pitch, duration: note.duration as NoteDuration, dots: note.dots, lyric, tie: note.tie };
        if (note.lyrics !== undefined) {
          const numbers = new Set<string>();
          result.lyrics = arrayValue(note.lyrics, '가사 절', 16, 1).map(input => {
            const entry = record(input, '가사 절');
            const number = stringValue(entry.number, '가사 절 번호', 32, false);
            if (!/^[\p{L}\p{N}_.:-]+$/u.test(number) || numbers.has(number)) throw new Error('가사 절 번호가 올바르지 않거나 중복되었습니다.');
            numbers.add(number);
            const text = stringValue(entry.text, '절별 가사', 120);
            if (/[\r\n]/.test(text)) throw new Error('음표의 절별 가사는 한 줄이어야 합니다.');
            const lyricEntry: NoteLyric = { number, text };
            if (entry.syllabic !== undefined) {
              if (!['single', 'begin', 'middle', 'end'].includes(entry.syllabic as string)) throw new Error('가사 음절 구분이 올바르지 않습니다.');
              lyricEntry.syllabic = entry.syllabic as NoteLyric['syllabic'];
            }
            if (entry.extend !== undefined) {
              if (!['start', 'continue', 'stop'].includes(entry.extend as string)) throw new Error('가사 늘임 표시가 올바르지 않습니다.');
              lyricEntry.extend = entry.extend as NoteLyric['extend'];
            }
            if (entry.endLine !== undefined) {
              if (typeof entry.endLine !== 'boolean') throw new Error('가사 줄 끝 표시가 올바르지 않습니다.');
              lyricEntry.endLine = entry.endLine;
            }
            return lyricEntry;
          });
          result.lyrics = getNoteLyrics(result);
        }
        return result;
      });
      const contentBeats = notes.reduce((sum, note) => sum + durationBeats(note), 0);
      const rhythmMismatch = Math.abs(contentBeats - actualBeats) > 0.000001;
      if (rhythmMismatch && measure.rhythmReview !== true) throw new Error(label + ': 한 마디의 음표 길이 합이 마디 실제 길이와 일치하지 않습니다.');
      const chordBeats = measure.rhythmReview === true ? MAX_REVIEW_BEATS : actualBeats;
      const chords: ScoreChord[] = arrayValue(measure.chords, '코드', 32).map((chordInput) => {
        const chord = record(chordInput, '코드');
        const symbol = stringValue(chord.symbol, '코드 기호', 40, false);
        parseChord(symbol);
        const beat = numberValue(chord.beat, '코드 박 위치', 1, chordBeats + 1);
        if (beat >= chordBeats + 1 || !Number.isInteger((beat - 1) * 4)) throw new Error('코드는 마디 안의 16분음표 단위 박에 놓아야 합니다.');
        return { id: id(chord.id), symbol, beat };
      });
      const chordMismatch = chords.some(chord => chord.beat >= actualBeats + 1);
      return { id: measureId, notes, chords, ...(measure.actualBeats !== undefined ? { actualBeats } : {}), ...((rhythmMismatch || chordMismatch) && measure.rhythmReview === true ? { rhythmReview: true as const } : {}) };
    });
    const allNotes = measures.flatMap((measure) => measure.notes);
    allNotes.forEach((note, index) => {
      if (note.tie && (allNotes[index + 1]?.pitch === null || !allNotes[index + 1] || parsePitch(allNotes[index + 1].pitch!).midi !== parsePitch(note.pitch!).midi)) throw new Error('붙임줄은 같은 구간의 다음 음높이가 같은 음표에 연결해야 합니다.');
    });
    return { id: sectionId, label, type: section.type as SectionType, measures };
  });
  const sectionIds = new Set(sections.map((section) => section.id));
  let playedMeasures = 0;
  const form = arrayValue(raw.form, '곡 순서', 128, 1).map((formInput) => {
    const entry = record(formInput, '곡 순서');
    const sectionId = stringValue(entry.sectionId, '구간 참조', 80, false);
    if (!sectionIds.has(sectionId)) throw new Error('곡 순서에 없는 구간을 참조했습니다.');
    const repeat = numberValue(entry.repeat, '반복 횟수', 1, 16, true);
    playedMeasures += sections.find((section) => section.id === sectionId)!.measures.length * repeat;
    if (playedMeasures > 4096) throw new Error('반복을 포함한 전체 마디는 4096개 이하여야 합니다.');
    return { id: id(entry.id), sectionId, repeat };
  });
  const warnings = arrayValue(raw.warnings, '인식 참고사항', 100).map((value) => stringValue(value, '참고사항', 500));
  return { version: 1, title, artist, key, timeSignature, tempo, sections, form, warnings, source: raw.source as Score['source'] };
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function xmlRoot(root: string, element: string, displayStep?: string, hideAlter = false): string {
  return '<' + element + '-step' + (displayStep === undefined ? '' : ' text="' + xml(displayStep) + '"') + '>' + root[0] + '</' + element + '-step>' + (root[1] ? '<' + element + '-alter' + (hideAlter ? ' print-object="no"' : '') + '>' + (root[1] === '#' ? 1 : -1) + '</' + element + '-alter>' : '');
}
function chordXML(chord: ScoreChord): string {
  const parsed = parseChord(chord.symbol);
  const offset = (chord.beat - 1) * 4;
  if (!parsed) return '<harmony><root><root-step text="">C</root-step></root><kind text="N.C.">none</kind><offset>' + offset + '</offset></harmony>';
  const kinds: Record<string, string> = { '': 'major', m: 'minor', min: 'minor', M: 'major', maj: 'major', '7': 'dominant', maj7: 'major-seventh', M7: 'major-seventh', m7: 'minor-seventh', min7: 'minor-seventh', m7b5: 'half-diminished', ø7: 'half-diminished', dim: 'diminished', dim7: 'diminished-seventh', '°': 'diminished', '°7': 'diminished-seventh', aug: 'augmented', '+': 'augmented', sus2: 'suspended-second', sus4: 'suspended-fourth', '6': 'major-sixth', m6: 'minor-sixth', '9': 'dominant-ninth', maj9: 'major-ninth', m9: 'minor-ninth', '11': 'dominant-11th', '13': 'dominant-13th' };
  let kind = kinds[parsed.suffix] || 'other';
  let degree = '';
  const added = /^([^()]*?)(?:add([#b]?)(2|9)|\((?:add)?([#b]?)(2|9)\))$/.exec(parsed.suffix);
  if (added && kinds[added[1]]) {
    kind = kinds[added[1]];
    const accidental = added[2] ?? added[4];
    degree = '<degree print-object="no"><degree-value>' + (added[3] ?? added[5]) + '</degree-value><degree-alter>' + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + '</degree-alter><degree-type>add</degree-type></degree>';
  }
  return '<harmony><root>' + xmlRoot(parsed.root, 'root', parsed.parenthesized ? '(' + parsed.root[0] : undefined) + '</root><kind text="' + xml(parsed.suffix + (parsed.parenthesized && !parsed.bass ? ')' : '')) + '">' + kind + '</kind>' + (parsed.bass ? '<bass>' + xmlRoot(parsed.bass, 'bass', parsed.parenthesized ? parsed.bass + ')' : undefined, parsed.parenthesized) + '</bass>' : '') + degree + '<offset>' + offset + '</offset></harmony>';
}

/** Expand the chosen song form into a single voice for broad MusicXML import support. */
export function exportMusicXML(score: Score): string {
  const key = keyInfo(score.key);
  const time = timeInfo(score.timeSignature);
  const types: Record<NoteDuration, string> = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th' };
  let number = 0;
  let previous: ScoreNote | undefined;
  const measures = playedSections(score).flatMap((section) => section.measures.map((measure, index) => {
    number++;
    const expectedBeats = measureBeats(measure, score.timeSignature);
    const contentBeats = measure.notes.reduce((sum, note) => sum + durationBeats(note), 0);
    const rhythmMismatch = Math.abs(contentBeats - expectedBeats) > 0.000001;
    const invalidChords = measure.chords.filter(chord => chord.beat >= expectedBeats + 1);
    const rhythmReview = measure.rhythmReview === true && (rhythmMismatch || invalidChords.length > 0);
    const reviewDetails = [rhythmMismatch ? '음표 길이 합 ' + contentBeats + '박 / 마디 길이 ' + expectedBeats + '박' : '', invalidChords.length ? '마디 길이를 벗어난 코드 박 위치: ' + invalidChords.map(chord => chord.beat).join(', ') : ''].filter(Boolean).join('; ');
    const attributes = number === 1 ? '<attributes><divisions>4</divisions><key><fifths>' + key.fifths + '</fifths><mode>' + (key.minor ? 'minor' : 'major') + '</mode></key><time><beats>' + time.beats + '</beats><beat-type>' + time.beatType + '</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : '';
    const direction = (index === 0 ? '<direction placement="above"><direction-type><rehearsal>' + xml(section.label) + '</rehearsal></direction-type></direction>' : '') + (number === 1 ? '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + score.tempo + '</per-minute></metronome></direction-type><sound tempo="' + score.tempo + '"/></direction>' : '') + (rhythmReview ? '<direction placement="above"><direction-type><words id="chanyang-review-m' + number + '-beats-' + expectedBeats + '">리듬 검토 필요: ' + reviewDetails + '</words></direction-type></direction>' : '');
    const notes = measure.notes.map((note) => {
      const parsed = note.pitch === null ? null : parsePitch(note.pitch);
      const stop = parsed && previous?.tie && previous.pitch !== null && parsePitch(previous.pitch).midi === parsed.midi;
      const ties = (stop ? '<tie type="stop"/>' : '') + (note.tie ? '<tie type="start"/>' : '');
      const notations = stop || note.tie ? '<notations>' + (stop ? '<tied type="stop"/>' : '') + (note.tie ? '<tied type="start"/>' : '') + '</notations>' : '';
      const pitch = parsed ? '<pitch><step>' + parsed.root[0] + '</step>' + (parsed.root[1] ? '<alter>' + (parsed.root[1] === '#' ? 1 : -1) + '</alter>' : '') + '<octave>' + parsed.octave + '</octave></pitch>' : '<rest/>';
      previous = note;
      return '<note>' + pitch + '<duration>' + durationBeats(note) * 4 + '</duration>' + ties + '<voice>1</voice><type>' + types[note.duration] + '</type>' + (note.dots ? '<dot/>' : '') + notations + getNoteLyrics(note).map(entry => '<lyric number="' + xml(entry.number) + '">' + (entry.syllabic ? '<syllabic>' + entry.syllabic + '</syllabic>' : '') + (entry.text || !entry.extend || entry.syllabic ? '<text>' + xml(entry.text) + '</text>' : '') + (entry.extend ? '<extend type="' + entry.extend + '"/>' : '') + (entry.endLine ? '<end-line/>' : '') + '</lyric>').join('') + '</note>';
    }).join('');
    return '<measure number="' + number + '"' + (rhythmReview ? ' implicit="no"' : expectedBeats < time.total ? ' implicit="yes"' : '') + '>' + attributes + direction + [...measure.chords].sort((a, b) => a.beat - b.beat).map(chordXML).join('') + notes + '</measure>';
  })).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0"><work><work-title>' + xml(score.title) + '</work-title></work><movement-title>' + xml(score.title) + '</movement-title><identification><creator type="composer">' + xml(score.artist) + '</creator></identification><part-list><score-part id="P1"><part-name>멜로디</part-name><score-instrument id="I1"><instrument-name>Voice</instrument-name></score-instrument></score-part></part-list><part id="P1">\n' + measures + '\n</part></score-partwise>';
}
