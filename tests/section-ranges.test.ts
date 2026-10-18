import assert from 'node:assert/strict';
import test from 'node:test';
import { exportLyrics, exportMusicXML, validateScore } from '../lib/music.ts';
import { parseMusicXML } from '../lib/musicxml-import.ts';
import { createSampleScore } from '../lib/sample.ts';
import type { Score, SectionType } from '../lib/score-types.ts';

let helpers: typeof import('../lib/section-ranges.ts') | undefined;
try { helpers = await import('../lib/section-ranges.ts'); }
catch (error) { if (!(error instanceof Error) || !/Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) throw error; }

function assign(...args: Parameters<NonNullable<typeof helpers>['assignSectionRange']>) {
  assert.ok(helpers, 'measure-range section assignment is not implemented');
  return helpers.assignSectionRange(...args);
}

function importedScore(): Score {
  const score = createSampleScore();
  score.form = score.sections.map((section, index) => ({ id: `source-form-${index}`, sectionId: section.id, repeat: 1 }));
  const note = score.sections[0].measures[0].notes[0];
  note.lyrics = [{ number: '1', text: note.lyric, syllabic: 'begin' }, { number: '2', text: '다른', syllabic: 'single', endLine: true }];
  return parseMusicXML(exportMusicXML(score));
}

const music = (score: Score) => score.sections.flatMap(section => section.measures);
function playedMeasures(score: Score): string[] {
  return score.form.flatMap(entry => Array.from({ length: entry.repeat }, () => score.sections.find(section => section.id === entry.sectionId)!.measures.map(measure => measure.id)).flat());
}
const withoutRehearsals = (xml: string) => xml.replace(/<direction placement="above"><direction-type><rehearsal>[\s\S]*?<\/rehearsal><\/direction-type><\/direction>/g, '');
const ids = () => { let number = 0; return () => `assigned-${++number}`; };

test('assigns imported measures 5–8 while preserving all musical data and input state', () => {
  const original = importedScore();
  const before = structuredClone(original);
  const result = assign(original, { sectionId: original.sections[0].id, startMeasure: 5, endMeasure: 8, label: 'C1', type: 'chorus' }, ids());
  assert.deepEqual(result.score.sections.map(section => section.measures.length), [4, 4, 8]);
  assert.deepEqual(music(result.score), music(original));
  assert.deepEqual(original, before);
  assert.equal(result.score.sections[0].id, original.sections[0].id);
  assert.equal(result.score.sections[1].id, result.selectedSectionId);
  assert.notEqual(result.selectedSectionId, original.sections[0].id);
  assert.equal(result.score.sections[1].label, 'C1');
  assert.equal(result.score.sections[1].type, 'chorus');
  assert.deepEqual(result.score.warnings, original.warnings);
  assert.doesNotThrow(() => validateScore(result.score));
  assert.equal(withoutRehearsals(exportMusicXML(result.score)), withoutRehearsals(exportMusicXML(original)));
  for (const verse of ['1', '2']) assert.equal(exportLyrics(result.score, { sectionNames: false, verse }).replace(/\s/g, ''), exportLyrics(original, { sectionNames: false, verse }).replace(/\s/g, ''));
  result.score.sections[1].measures[0].notes[0].lyric = '수정';
  assert.deepEqual(original, before);
});

test('expands each repeat as a whole before/assigned/after sequence in every form occurrence', () => {
  const score = createSampleScore();
  score.form = [{ id: 'repeat-form', sectionId: score.sections[0].id, repeat: 3 }, score.form[2], { id: 'again-form', sectionId: score.sections[0].id, repeat: 2 }];
  const expected = playedMeasures(score);
  const result = assign(score, { sectionId: score.sections[0].id, startMeasure: 2, endMeasure: 3, label: 'P1', type: 'prechorus' }, ids());
  assert.deepEqual(playedMeasures(result.score), expected);
  assert.equal(result.score.form.length, 16);
  assert.ok(result.score.form.filter(entry => entry.sectionId === result.selectedSectionId).every(entry => entry.repeat === 1));
  assert.equal(result.score.form[0].id, 'repeat-form');
  assert.equal(result.score.form[10].id, 'again-form');
  assert.deepEqual(result.score.form[9], score.form[1]);
});

test('full-section assignment reuses section and form IDs without allocating new IDs', () => {
  const score = createSampleScore();
  score.form[0].repeat = 2;
  const result = assign(score, { sectionId: score.sections[0].id, startMeasure: 1, endMeasure: 4, label: 'V3', type: 'verse' }, () => { throw new Error('unexpected allocation'); });
  assert.equal(result.selectedSectionId, score.sections[0].id);
  assert.equal(result.score.sections.length, score.sections.length);
  assert.deepEqual(result.score.form, score.form);
  assert.deepEqual(music(result.score), music(score));
});

test('leading and trailing single-measure assignments reuse the remaining fragment ID', () => {
  for (const [startMeasure, endMeasure, lengths, retainedIndex] of [[1, 1, [1, 3], 1], [4, 4, [3, 1], 0]] as const) {
    const score = createSampleScore();
    const original = score.sections[0];
    const result = assign(score, { sectionId: original.id, startMeasure, endMeasure, label: 'I1', type: 'intro' }, ids());
    assert.deepEqual(result.score.sections.slice(0, 2).map(section => section.measures.length), lengths);
    assert.equal(result.score.sections[retainedIndex].id, original.id);
    assert.notEqual(result.selectedSectionId, original.id);
    assert.deepEqual(playedMeasures(result.score), playedMeasures(score));
  }
});

test('consecutive splits can use the remaining part without changing music or played measure order', () => {
  const original = importedScore();
  const originalMusic = structuredClone(music(original));
  const originalPlayed = playedMeasures(original);
  const makeID = ids();
  const first = assign(original, { sectionId: original.sections[0].id, startMeasure: 1, endMeasure: 4, label: '1절', type: 'verse' }, makeID);
  const remaining = first.score.sections[1];
  const second = assign(first.score, { sectionId: remaining.id, startMeasure: 1, endMeasure: 4, label: '후렴', type: 'chorus' }, makeID);
  assert.deepEqual(second.score.sections.map(section => section.measures.length), [4, 4, 8]);
  assert.deepEqual(second.score.sections.slice(0, 2).map(section => section.label), ['1절', '후렴']);
  assert.equal(second.selectedSectionId, second.score.sections[1].id);
  assert.deepEqual(music(second.score), originalMusic);
  assert.deepEqual(playedMeasures(second.score), originalPlayed);
  assert.equal(withoutRehearsals(exportMusicXML(second.score)), withoutRehearsals(exportMusicXML(original)));
  assert.deepEqual(music(original), originalMusic);
});

test('remainder names stay nonempty, bounded and distinct from existing or assigned labels', () => {
  const score = createSampleScore();
  score.sections[0].label = '가'.repeat(60);
  score.sections[1].label = '가'.repeat(56) + ' (앞)';
  const result = assign(score, { sectionId: score.sections[0].id, startMeasure: 2, endMeasure: 2, label: score.sections[2].label, type: 'chorus' }, ids());
  const [before, assigned, after] = result.score.sections;
  assert.equal(assigned.label, 'C');
  assert.ok(before.label.length <= 60 && after.label.length <= 60);
  assert.match(before.label, /\(앞 2\)$/);
  assert.notEqual(before.label, after.label);
  assert.ok(!score.sections.slice(1).some(section => section.label === before.label || section.label === after.label));
  assert.doesNotThrow(() => validateScore(result.score));
});

test('rejects absent sections and noninteger, reversed or out-of-section measure ranges', () => {
  const score = createSampleScore();
  const before = structuredClone(score);
  for (const [startMeasure, endMeasure] of [[0, 1], [1, 5], [3, 2], [1.5, 3], [1, NaN], [Infinity, 4]]) {
    assert.throws(() => assign(score, { sectionId: score.sections[0].id, startMeasure, endMeasure, label: 'V1', type: 'verse' }), /마디/);
  }
  assert.throws(() => assign(score, { sectionId: 'missing', startMeasure: 1, endMeasure: 1, label: 'V1', type: 'verse' }), /구간/);
  assert.deepEqual(score, before);
});

test('rejects invalid labels and section types without changing the score', () => {
  const score = createSampleScore();
  for (const label of ['', '   ', 'V'.repeat(61), 'V\u0000']) assert.throws(() => assign(score, { sectionId: score.sections[0].id, startMeasure: 1, endMeasure: 4, label, type: 'verse' }), /구간 이름/);
  assert.throws(() => assign(score, { sectionId: score.sections[0].id, startMeasure: 1, endMeasure: 4, label: 'V1', type: 'invalid' as SectionType }), /구간 종류/);
});

test('rejects section-count and expanded-form limits using score validation', () => {
  const sections = createSampleScore();
  const template = sections.sections[0];
  sections.sections = Array.from({ length: 32 }, (_, index) => ({ ...structuredClone(template), id: `section-limit-${index}`, measures: template.measures.map((measure, measureIndex) => ({ ...structuredClone(measure), id: `limit-measure-${index}-${measureIndex}`, notes: measure.notes.map((note, noteIndex) => ({ ...note, id: `limit-note-${index}-${measureIndex}-${noteIndex}` })), chords: measure.chords.map((chord, chordIndex) => ({ ...chord, id: `limit-chord-${index}-${measureIndex}-${chordIndex}` })) })) }));
  sections.form = [{ id: 'limit-form', sectionId: sections.sections[0].id, repeat: 1 }];
  assert.doesNotThrow(() => validateScore(sections));
  assert.throws(() => assign(sections, { sectionId: sections.sections[0].id, startMeasure: 2, endMeasure: 3, label: 'C1', type: 'chorus' }, ids()), /구간/);
  const form = createSampleScore();
  form.form = Array.from({ length: 64 }, (_, index) => ({ id: `form-limit-${index}`, sectionId: form.sections[0].id, repeat: 1 }));
  assert.doesNotThrow(() => validateScore(form));
  assert.throws(() => assign(form, { sectionId: form.sections[0].id, startMeasure: 2, endMeasure: 3, label: 'C1', type: 'chorus' }, ids()), /곡 순서/);
});

test('rejects cuts through tied notes instead of deleting or changing musical data', () => {
  const score = createSampleScore();
  score.sections[0].measures[0].notes[3].tie = true;
  score.sections[0].measures[1].notes[0].pitch = score.sections[0].measures[0].notes[3].pitch;
  assert.doesNotThrow(() => validateScore(score));
  const before = structuredClone(score);
  assert.throws(() => assign(score, { sectionId: score.sections[0].id, startMeasure: 2, endMeasure: 3, label: 'C1', type: 'chorus' }, ids()), /붙임줄/);
  assert.deepEqual(score, before);
});

test('rejects malformed source scores and colliding generated IDs', () => {
  const score = createSampleScore();
  assert.throws(() => assign(score, { sectionId: score.sections[0].id, startMeasure: 2, endMeasure: 3, label: 'C1', type: 'chorus' }, () => score.sections[1].measures[0].notes[0].id), /ID/);
  score.form[0].repeat = 17;
  assert.throws(() => assign(score, { sectionId: score.sections[0].id, startMeasure: 1, endMeasure: 4, label: 'V1', type: 'verse' }), /반복/);
});
