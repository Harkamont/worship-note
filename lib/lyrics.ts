import type { NoteLyric, ScoreNote, ScoreSection } from './score-types.ts';

/** lyric remains the editable primary text for legacy projects and AI responses. */
export function getNoteLyrics(note: ScoreNote): NoteLyric[] {
  if (!note.lyrics?.length) return note.lyric ? [{ number: '1', text: note.lyric }] : [];
  const entries = note.lyrics.map(entry => ({ ...entry }));
  const first = Math.max(0, entries.findIndex(entry => entry.number === '1'));
  if (entries[first].text !== note.lyric) entries[first] = { number: entries[first].number, text: note.lyric };
  return entries;
}

/** Editing plain text invalidates only the primary line's old notation metadata. */
export function withNoteLyric(note: ScoreNote, lyric: string): ScoreNote {
  const result = { ...note, lyric };
  if (note.lyrics) result.lyrics = getNoteLyrics(result);
  return result;
}

export function lyricVerseNumbers(sections: readonly ScoreSection[]): string[] {
  const numbers = new Set(sections.flatMap(section => section.measures.flatMap(measure => measure.notes.flatMap(note => getNoteLyrics(note).map(entry => entry.number)))));
  return [...numbers].sort((a, b) => a === '1' ? -1 : b === '1' ? 1 : 0);
}

function plainText(text: string): string {
  // A standalone engraving dash/extension is not a sung word. Inner hyphens stay intact.
  return /^[\s\-‐‑‒–—―−_＿]+$/u.test(text) ? '' : text;
}

export function sectionLyricText(section: ScoreSection, verse?: string): string {
  const selected = verse ?? lyricVerseNumbers([section])[0] ?? '1';
  const entryFor = (note: ScoreNote) => getNoteLyrics(note).find(entry => entry.number === selected);
  const entries = section.measures.flatMap(measure => measure.notes.map(entryFor));
  const semantic = entries.some(entry => entry && (entry.syllabic || entry.extend || entry.endLine));
  if (!semantic) return section.measures.map(measure => measure.notes.map(note => plainText(entryFor(note)?.text ?? '')).join('').trim()).filter(Boolean).join('\n');
  let output = '';
  let wordEnded = false;
  for (const entry of entries) {
    if (!entry) continue;
    const text = plainText(entry.text);
    if (text) {
      if (wordEnded && output && !/\s$/.test(output) && !/^\s/.test(text)) output += ' ';
      output += text;
      wordEnded = entry.syllabic === 'single' || entry.syllabic === 'end';
    }
    if (entry.endLine) { output = output.trimEnd() + '\n'; wordEnded = false; }
  }
  return output.trim();
}
