import assert from 'node:assert/strict';
import test from 'node:test';
import * as music from '../lib/music.ts';
import { createEmptyMeasure } from '../lib/editor.ts';
import { parseMusicXML } from '../lib/musicxml-import.ts';
import { parseProject, serializeProject } from '../lib/project-io.ts';
import { createBlankScore } from '../lib/sample.ts';
import { assignSectionRange } from '../lib/section-ranges.ts';
import type { ScoreMeasure } from '../lib/score-types.ts';

const attributes = '<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const note = (beats: number, type: string, dots = '') => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${beats * 4}</duration><voice>1</voice><type>${type}</type>${dots}<lyric number="1"><text>주</text></lyric></note>`;
const measure = (inside: string, attributes = '') => `<measure number="1"${attributes}>${inside}</measure>`;
const xml = (measures: string) => `<score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
const pitches = (measure: ScoreMeasure) => measure.notes.map(({ pitch, duration, dots, lyric }) => ({ pitch, duration, dots, lyric }));

test('imports short first measures as pickups without adding rests or changing note lengths', () => {
  for (const [beats, type, dots] of [[0.25, '16th', ''], [0.5, 'eighth', ''], [1, 'quarter', ''], [3, 'half', '<dot/>']] as const) {
    const score = parseMusicXML(xml(measure(attributes + note(beats, type, dots)) + measure(note(4, 'whole'))));
    const first = score.sections[0].measures[0];
    assert.equal(first.actualBeats, beats);
    assert.equal(first.notes.length, 1);
    assert.equal(music.durationBeats(first.notes[0]), beats);
    assert.equal(first.notes[0].lyric, '주');
    assert.match(score.warnings.join('\n'), /첫 마디.*못갖춘마디.*확인/);
    assert.equal(score.sections[0].measures[1].actualBeats, undefined);
  }
});

test('accepts explicitly implicit short measures later in the score but rejects ordinary incomplete bars', () => {
  const full = measure(attributes + note(4, 'whole'));
  const source = xml(full + measure(note(1, 'quarter'), ' implicit="yes"'));
  assert.equal(parseMusicXML(source).sections[0].measures[1].actualBeats, 1);
  assert.throws(() => parseMusicXML(xml(full + measure(note(1, 'quarter')))), /2마디.*1박.*4박/);
  assert.throws(() => parseMusicXML(xml(measure(attributes + note(4, 'whole') + note(1, 'quarter'), ' implicit="yes"'))), /5박.*4박/);
});

test('retains untyped whole-measure rests in pickups using their actual XML duration', () => {
  for (const beats of [0.25, 0.5, 1, 3]) {
    const rest = `<note><rest measure="yes"/><duration>${beats * 4}</duration></note>`;
    const imported = parseMusicXML(xml(measure(attributes + rest, ' implicit="yes"'))).sections[0].measures[0];
    assert.equal(imported.actualBeats, beats);
    assert.equal(imported.notes.length, 1);
    assert.equal(imported.notes[0].pitch, null);
    assert.equal(music.durationBeats(imported.notes[0]), beats);
  }
});

test('full v1 measures retain their shape and helper returns nominal or actual quarter beats', () => {
  assert.equal(typeof music.measureBeats, 'function');
  const original = createBlankScore();
  assert.deepEqual(music.validateScore(original), original);
  assert.equal(music.measureBeats(original.sections[0].measures[0], '4/4'), 4);
  assert.equal(music.measureBeats({ ...original.sections[0].measures[0], actualBeats: 0.5 }, '4/4'), 0.5);
  assert.equal(music.measureBeats(original.sections[0].measures[0], '6/8'), 3);
  assert.equal(parseMusicXML(xml(measure(attributes + note(4, 'whole'), ' implicit="yes"'))).sections[0].measures[0].actualBeats, undefined);
});

test('validates actual measure length and requires exact note totals and bounded chord positions', () => {
  const score = createBlankScore();
  const first = score.sections[0].measures[0];
  first.actualBeats = 0.5;
  first.notes = [{ ...first.notes[0], duration: '8' }];
  first.chords = [{ id: 'pickup-chord', symbol: 'C', beat: 1.25 }];
  assert.equal(music.validateScore(score).sections[0].measures[0].actualBeats, 0.5);
  for (const actualBeats of [0, -1, 4.25, Number.NaN, Number.POSITIVE_INFINITY, 0.1, '0.5', null]) {
    assert.throws(() => music.validateScore({ ...score, sections: [{ ...score.sections[0], measures: [{ ...first, actualBeats }] }] }));
  }
  first.chords[0].beat = 1.5;
  assert.throws(() => music.validateScore(score), /코드/);
  first.chords[0].beat = 1;
  first.actualBeats = 1;
  assert.throws(() => music.validateScore(score), /음표 길이 합/);
  delete first.actualBeats;
  assert.throws(() => music.validateScore(score), /음표 길이 합/);
});

test('preserves pickup length through projects, section splits, transposition and repeated MusicXML form', () => {
  const original = parseMusicXML(xml(measure(attributes + note(1, 'quarter')) + measure(note(4, 'whole'))));
  const restored = parseProject(serializeProject({ score: original, originalImage: null, originalName: '', recognition: null, updatedAt: '2026-10-18T00:00:00.000Z' })).score;
  const split = assignSectionRange(restored, { sectionId: restored.sections[0].id, startMeasure: 1, endMeasure: 1, label: '시작', type: 'intro' }).score;
  const moved = music.transposeScore(split, 'D');
  assert.equal(moved.sections[0].measures[0].actualBeats, 1);
  moved.form = [{ id: 'repeated-pickup', sectionId: moved.sections[0].id, repeat: 2 }];
  const exported = music.exportMusicXML(moved);
  assert.equal((exported.match(/implicit="yes"/g) ?? []).length, 2);
  const imported = parseMusicXML(exported).sections[0].measures;
  assert.deepEqual(imported.map(m => m.actualBeats), [1, 1]);
  assert.deepEqual(imported.map(pitches), [pitches(moved.sections[0].measures[0]), pitches(moved.sections[0].measures[0])]);
});

test('creates exact rest measures for manual pickups without altering the full-bar default', () => {
  for (const beats of [0.25, 0.5, 1, 3]) {
    const result = createEmptyMeasure('4/4', beats);
    assert.equal(result.actualBeats, beats);
    assert.equal(result.notes.reduce((total, note) => total + music.durationBeats(note), 0), beats);
    assert.ok(result.notes.every(note => note.pitch === null));
  }
  assert.equal(createEmptyMeasure('4/4').actualBeats, undefined);
  for (const beats of [0, -1, 5, 0.1, Number.NaN]) assert.throws(() => createEmptyMeasure('4/4', beats));
});
