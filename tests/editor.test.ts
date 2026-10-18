import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyMeasure } from '../lib/editor.ts';
import { durationBeats, validateScore } from '../lib/music.ts';
import { createBlankScore } from '../lib/sample.ts';

test('new measures match 4/4, 3/4, 6/8 and 5/8 and pass score validation', () => {
  for (const [timeSignature, expectedBeats] of [['4/4', 4], ['3/4', 3], ['6/8', 3], ['5/8', 2.5]] as const) {
    const measure = createEmptyMeasure(timeSignature);
    const score = createBlankScore();
    score.timeSignature = timeSignature;
    score.sections[0].measures = [measure];
    assert.doesNotThrow(() => validateScore(score));
    assert.equal(measure.notes.reduce((sum, note) => sum + durationBeats(note), 0), expectedBeats);
    assert.deepEqual(measure.chords, []);
    assert.ok(measure.notes.every((note) => note.pitch === null && note.lyric === '' && !note.tie));
  }
});

test('four-quarter-beat measures use a single whole rest', () => {
  for (const meter of ['4/4', '2/2', '8/8']) {
    const { notes } = createEmptyMeasure(meter);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].duration, 'w');
    assert.equal(notes[0].dots, 0);
    assert.equal(durationBeats(notes[0]), 4);
  }
});

test('other meters use one rest per denominator beat and support all domain meters', () => {
  assert.deepEqual(createEmptyMeasure('6/8').notes.map((note) => note.duration), Array(6).fill('8'));
  assert.deepEqual(createEmptyMeasure('5/8').notes.map((note) => note.duration), Array(5).fill('8'));
  for (const denominator of [2, 4, 8, 16]) for (let numerator = 1; numerator <= 12; numerator++) {
    const score = createBlankScore();
    score.timeSignature = `${numerator}/${denominator}`;
    score.sections[0].measures = [createEmptyMeasure(score.timeSignature)];
    assert.doesNotThrow(() => validateScore(score));
  }
});

test('each measure and note has a fresh UUID and no mutable state is shared', () => {
  const first = createEmptyMeasure('6/8');
  const second = createEmptyMeasure('6/8');
  const ids = [first.id, second.id, ...first.notes.map((note) => note.id), ...second.notes.map((note) => note.id)];
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  first.notes[0].lyric = '수정';
  first.chords.push({ id: crypto.randomUUID(), beat: 1, symbol: 'C' });
  assert.equal(second.notes[0].lyric, '');
  assert.deepEqual(second.chords, []);
});

test('rejects meters outside the domain parser limits', () => {
  for (const meter of ['', '0/4', '13/4', '4/1', '4/3', '4/0', '4 /4', '100/4', '3.5/4']) assert.throws(() => createEmptyMeasure(meter));
});
