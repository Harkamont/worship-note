import { getNoteLyrics, withNoteLyric } from './lyrics.ts';
import { transposePitch } from './music.ts';
import type { NoteLyric, ScoreNote, ScoreSection } from './score-types.ts';

export interface LyricEntryUnit { text: string; skip: boolean; syllabic?: NoteLyric['syllabic']; endLine?: true; }
export interface LyricEntryRow {
  noteId: string;
  measureNumber: number;
  noteNumber: number;
  pitch: string;
  before: string;
  unit: LyricEntryUnit | null;
}
export interface SectionLyricPreview {
  rows: LyricEntryRow[];
  availableNotes: number;
  lyricUnits: number;
  skipUnits: number;
  restNotes: number;
  tiedNotes: number;
  excludedLyrics: { measureNumber: number; noteNumber: number; text: string; kind: 'rest' | 'tied' }[];
  extraUnits: number;
  missingUnits: number;
  remaining: LyricEntryUnit[];
  canApply: boolean;
  error: string;
}

function lyricUnits(input: string): LyricEntryUnit[] {
  const result: LyricEntryUnit[] = [];
  const parts = input.normalize('NFC').trim().match(/\S+|\s+/gu) ?? [];
  for (const part of parts) {
    if (/^\s+$/u.test(part)) {
      const previous = result.findLast(unit => !unit.skip);
      if (!previous) continue;
      if (/[\r\n]/.test(part)) previous.endLine = true;
      else if (!previous.endLine && !/\s$/.test(previous.text)) previous.text += part;
      continue;
    }
    if (part === '-') { result.push({ text: '', skip: true }); continue; }
    if (!/\p{Script=Hangul}/u.test(part)) { result.push({ text: part, skip: false, syllabic: 'single' }); continue; }
    let prefix = '';
    const word: LyricEntryUnit[] = [];
    for (const piece of part.match(/[\p{Script=Hangul}]|[^\p{Script=Hangul}]+/gu) ?? []) {
      if (/^[\p{P}\p{S}]+$/u.test(piece)) {
        if (word.length) word[word.length - 1].text += piece;
        else prefix += piece;
      } else { word.push({ text: prefix + piece, skip: false }); prefix = ''; }
    }
    if (prefix && word.length) word[word.length - 1].text += prefix;
    word.forEach((unit, index) => { unit.syllabic = word.length === 1 ? 'single' : index === 0 ? 'begin' : index === word.length - 1 ? 'end' : 'middle'; });
    result.push(...word);
  }
  return result;
}

/** Preview alone never changes notes. Every eligible note requires one unit or an explicit '-'. */
export function previewSectionLyrics(section: ScoreSection, text: string): SectionLyricPreview {
  const units = lyricUnits(text);
  const rows: LyricEntryRow[] = [];
  const excludedLyrics: SectionLyricPreview['excludedLyrics'] = [];
  let restNotes = 0;
  let tiedNotes = 0;
  let previous: ScoreNote | undefined;
  section.measures.forEach((measure, measureIndex) => measure.notes.forEach((note, noteIndex) => {
    const kind = note.pitch === null ? 'rest' : previous?.tie && previous.pitch && transposePitch(previous.pitch, 0) === transposePitch(note.pitch, 0) ? 'tied' : null;
    if (kind === 'rest') restNotes++;
    else if (kind === 'tied') tiedNotes++;
    else rows.push({ noteId: note.id, measureNumber: measureIndex + 1, noteNumber: noteIndex + 1, pitch: note.pitch!, before: note.lyric, unit: units[rows.length] ?? null });
    if (kind && !/^[\s\-‐‑‒–—―−_＿]*$/u.test(note.lyric)) excludedLyrics.push({ measureNumber: measureIndex + 1, noteNumber: noteIndex + 1, text: note.lyric, kind });
    previous = note;
  }));
  const lyricCount = units.filter(unit => !unit.skip).length;
  const extraUnits = Math.max(0, units.length - rows.length);
  const missingUnits = Math.max(0, rows.length - units.length);
  let error = '';
  if (!lyricCount) error = '가사를 입력해 주세요. 건너뛰기 표시만으로는 적용할 수 없습니다.';
  else if (!rows.length) error = '이 구간에는 가사를 넣을 멜로디 음표가 없습니다.';
  else if (units.some(unit => unit.text.length > 120 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(unit.text))) error = '한 음표에 넣을 글자가 너무 길거나 사용할 수 없는 문자가 있습니다.';
  else if (excludedLyrics.length) error = `건너뛸 음표·쉼표 ${excludedLyrics.length}개에 기존 가사가 남아 있습니다. 악보 편집에서 아래 가사를 확인·수정한 뒤 다시 미리 봐 주세요. 기존 가사는 자동으로 지우지 않습니다.`;
  else if (extraUnits) error = `입력한 가사 단위가 ${extraUnits}개 많습니다. 남은 글자를 확인해 주세요.`;
  else if (missingUnits) error = `입력한 가사 단위가 ${missingUnits}개 부족합니다. 늘여 부르는 음표에는 독립된 -를 넣어 주세요.`;
  return { rows, availableNotes: rows.length, lyricUnits: lyricCount, skipUnits: units.length - lyricCount, restNotes, tiedNotes, excludedLyrics, extraUnits, missingUnits, remaining: units.slice(rows.length), canApply: !error, error };
}

/** Recheck the current notes before applying; mismatches never truncate input or erase remaining lyrics. */
export function applySectionLyrics(section: ScoreSection, text: string): ScoreSection {
  const preview = previewSectionLyrics(section, text);
  if (!preview.canApply) throw new Error(preview.error);
  const updates = new Map(preview.rows.map(row => [row.noteId, row.unit!]));
  return { ...section, measures: section.measures.map(measure => ({ ...measure, notes: measure.notes.map(note => {
    const unit = updates.get(note.id);
    if (!unit) return note;
    const changed = withNoteLyric(note, unit.text);
    const lines = getNoteLyrics(changed);
    const primary = Math.max(0, lines.findIndex(line => line.number === '1'));
    const number = lines[primary]?.number ?? '1';
    // Keep text spacing, word syllables and line endings in MusicXML-compatible fields.
    const replacement: NoteLyric = { number, text: unit.text, ...(unit.syllabic ? { syllabic: unit.syllabic } : {}), ...(unit.endLine ? { endLine: true } : {}) };
    changed.lyrics = lines.length ? lines.map((line, index) => index === primary ? replacement : line) : [replacement];
    return changed;
  }) })) };
}
