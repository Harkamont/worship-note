import assert from 'node:assert/strict';
import test from 'node:test';
import { sectionLyricText } from '../lib/lyrics.ts';
import { validateScore } from '../lib/music.ts';
import { createSampleScore } from '../lib/sample.ts';
import type { ScoreNote, ScoreSection } from '../lib/score-types.ts';

let entry: typeof import('../lib/lyric-entry.ts') | undefined;
try { entry = await import('../lib/lyric-entry.ts'); } catch (error) { if (!(error instanceof Error) || !/Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) throw error; }
const note = (id: string, overrides: Partial<ScoreNote> = {}): ScoreNote => ({ id, pitch: 'C4', duration: 'q', dots: 0, tie: false, lyric: id, ...overrides });
const part = (...measures: ScoreNote[][]): ScoreSection => ({ id: 'v1', label: '1절', type: 'verse', measures: measures.map((notes, index) => ({ id: 'm' + index, notes, chords: [{ id: 'c' + index, beat: 1, symbol: 'C' }] })) });
function api() { assert.ok(entry, 'bulk lyric entry is not implemented'); return entry; }

test('Korean syllables retain word spaces and line breaks across barlines', () => {
  const section = part([note('a'), note('b'), note('c'), note('d')], [note('e'), note('f'), note('g'), note('h')]);
  const preview = api().previewSectionLyrics(section, '하나님  사랑\n나의 주');
  assert.equal(preview.availableNotes, 8);
  assert.equal(preview.lyricUnits, 8);
  assert.equal(preview.canApply, true);
  const result = api().applySectionLyrics(section, '하나님  사랑\n나의 주');
  assert.equal(sectionLyricText(result), '하나님  사랑\n나의 주');
});

test('rests and a tied continuation across a barline do not consume lyric units', () => {
  const section = part([note('a', { tie: true }), note('b', { pitch: 'C4', tie: true, lyric: '' })], [note('c', { pitch: 'C4', lyric: '-' }), note('rest', { pitch: null, lyric: '' }), note('d', { pitch: 'D4' })]);
  const preview = api().previewSectionLyrics(section, '주 님');
  assert.equal(preview.availableNotes, 2);
  assert.equal(preview.tiedNotes, 2);
  assert.equal(preview.restNotes, 1);
  const changed = api().applySectionLyrics(section, '주 님');
  assert.equal(changed.measures[0].notes[0].lyric, '주 ');
  assert.strictEqual(changed.measures[0].notes[1], section.measures[0].notes[1]);
  assert.strictEqual(changed.measures[1].notes[0], section.measures[1].notes[0]);
  assert.strictEqual(changed.measures[1].notes[1], section.measures[1].notes[1]);
  assert.equal(changed.measures[1].notes[2].lyric, '님');
});

test('enharmonic spelling on a tied note still counts as the same sounding pitch', () => {
  const section = part([note('a', { pitch: 'C#4', tie: true })], [note('b', { pitch: 'Db4', lyric: '' }), note('c', { pitch: 'D4' })]);
  const preview = api().previewSectionLyrics(section, '주 님');
  assert.equal(preview.availableNotes, 2);
  assert.equal(preview.tiedNotes, 1);
  assert.equal(preview.canApply, true);
});

test('only a standalone hyphen skips one extra sung note; real hyphenated words survive', () => {
  const section = part([note('a'), note('b'), note('c'), note('d')]);
  const preview = api().previewSectionLyrics(section, '주 - a-men 사랑');
  assert.equal(preview.lyricUnits, 4);
  assert.equal(preview.skipUnits, 1);
  assert.equal(preview.extraUnits, 1);
  const result = api().applySectionLyrics(section, '주 - a-men 님');
  assert.equal(result.measures[0].notes[1].lyric, '');
  assert.equal(result.measures[0].notes[2].lyric, 'a-men ');
  assert.equal(sectionLyricText(result), '주 a-men 님');
});

test('English words are opaque units and inner Korean hyphens are not dropped', () => {
  const section = part([note('a'), note('b'), note('c'), note('d'), note('e')]);
  const result = api().applySectionLyrics(section, 'a-men my 하-나님');
  assert.deepEqual(result.measures[0].notes.map(value => value.lyric), ['a-men ', 'my ', '하-', '나', '님']);
});

test('word metadata keeps correct MusicXML syllabic boundaries instead of joining every word', () => {
  const section = part([note('a'), note('b'), note('c'), note('d')]);
  const result = api().applySectionLyrics(section, '하나님 Lord');
  assert.deepEqual(result.measures[0].notes.map(value => value.lyrics?.[0].syllabic), ['begin', 'middle', 'end', 'single']);
  assert.equal(sectionLyricText(result), '하나님 Lord');
});

test('extra or missing units are exact and cannot truncate or wipe existing lyrics', () => {
  const section = part([note('a'), note('b'), note('c')]);
  const original = structuredClone(section);
  const extra = api().previewSectionLyrics(section, '하나님 사랑');
  assert.equal(extra.extraUnits, 2);
  assert.equal(extra.missingUnits, 0);
  assert.equal(extra.canApply, false);
  assert.throws(() => api().applySectionLyrics(section, '하나님 사랑'), /2.*많/);
  const missing = api().previewSectionLyrics(section, '주');
  assert.equal(missing.missingUnits, 2);
  assert.equal(missing.extraUnits, 0);
  assert.throws(() => api().applySectionLyrics(section, '주'), /2.*부족/);
  assert.deepEqual(section, original);
});

test('primary verse changes preserve other verses and all musical fields', () => {
  const section = part([note('a', { duration: 'h', dots: 1, lyrics: [{ number: '1', text: 'a', syllabic: 'begin', extend: 'start' }, { number: '2', text: '둘째', syllabic: 'single', endLine: true }] }), note('b')]);
  const original = structuredClone(section);
  const changed = api().applySectionLyrics(section, '주님');
  assert.deepEqual(changed.measures[0].notes[0].lyrics?.find(verse => verse.number === '2'), original.measures[0].notes[0].lyrics?.[1]);
  assert.deepEqual(section, original);
  for (let index = 0; index < 2; index++) {
    const oldMusic = Object.fromEntries(Object.entries(original.measures[0].notes[index]).filter(([key]) => !['lyric', 'lyrics'].includes(key)));
    const newMusic = Object.fromEntries(Object.entries(changed.measures[0].notes[index]).filter(([key]) => !['lyric', 'lyrics'].includes(key)));
    assert.deepEqual(newMusic, oldMusic);
  }
  assert.strictEqual(changed.measures[0].chords, section.measures[0].chords);
});

test('when verse 1 is absent the existing primary verse stays primary without duplicating a number', () => {
  const section = part([note('a', { lyrics: [{ number: '2', text: 'a' }, { number: '3', text: '그대로' }] })]);
  const changed = api().applySectionLyrics(section, '주');
  assert.deepEqual(changed.measures[0].notes[0].lyrics?.map(value => [value.number, value.text]), [['2', '주'], ['3', '그대로']]);
});

test('blank input, only skip marks, and no melody cannot be applied', () => {
  for (const [section, text] of [[part([note('a')]), '  \n'], [part([note('a')]), '-'], [part([note('rest', { pitch: null })]), '주']] as const) {
    assert.equal(api().previewSectionLyrics(section, text).canApply, false);
    assert.throws(() => api().applySectionLyrics(section, text));
  }
});

test('bulk input produces valid note lyric metadata with no embedded newline', () => {
  const score = createSampleScore();
  score.sections = [part([note('a'), note('b'), note('c'), note('d')])];
  score.form = [{ id: 'f', sectionId: 'v1', repeat: 1 }];
  score.sections[0] = api().applySectionLyrics(score.sections[0], '주 님\n사랑');
  const valid = validateScore(score);
  assert.equal(sectionLyricText(valid.sections[0]), '주 님\n사랑');
  assert.ok(valid.sections[0].measures[0].notes.every(value => !/[\r\n]/.test(value.lyric)));
});

test('existing sung text on excluded tied notes or rests blocks apply without deleting it', () => {
  const section = part([note('a', { tie: true }), note('b', { lyric: '옛가사' }), note('c', { pitch: 'D4' }), note('rest', { pitch: null, lyric: '쉼표가사' })]);
  const original = structuredClone(section);
  const preview = api().previewSectionLyrics(section, '주 님');
  assert.equal(preview.extraUnits, 0);
  assert.equal(preview.missingUnits, 0);
  assert.equal(preview.canApply, false);
  assert.deepEqual(preview.excludedLyrics, [
    { measureNumber: 1, noteNumber: 2, text: '옛가사', kind: 'tied' },
    { measureNumber: 1, noteNumber: 4, text: '쉼표가사', kind: 'rest' },
  ]);
  assert.match(preview.error, /기존 가사/);
  assert.throws(() => api().applySectionLyrics(section, '주 님'), /악보 편집/);
  assert.deepEqual(section, original);
});

test('empty or engraving-only excluded lyrics do not block or contaminate the final TXT', () => {
  const section = part([note('a', { tie: true }), note('b', { lyric: '—' }), note('c', { pitch: 'D4' }), note('rest', { pitch: null, lyric: '  ' })]);
  const preview = api().previewSectionLyrics(section, '주 님');
  assert.equal(preview.canApply, true);
  assert.deepEqual(preview.excludedLyrics, []);
  assert.equal(sectionLyricText(api().applySectionLyrics(section, '주 님')), '주 님');
});
