import assert from 'node:assert/strict';
import test from 'node:test';

const api = await import('../lib/score-layout.ts').catch(() => null);
function layoutApi() { assert.ok(api, 'score layout module must exist'); return api; }
function melody(count: number, width = 24) {
  return Array.from({ length: count }, (_, index) => ({ beat: 1 + index * 4 / count, left: width / 2, right: width / 2 }));
}

test('dense bars wrap before the requested maximum instead of compressing notes', () => {
  const { spaceMeasure, wrapMeasures } = layoutApi();
  const dense = spaceMeasure({ notes: melody(16), chords: [], beats: 4 });
  const rows = wrapMeasures(Array.from({ length: 4 }, (_, index) => ({ id: String(index), minimumWidth: dense.minimumWidth })), {
    lineWidth: 884, maximumMeasures: 4, firstHeaderWidth: 110, lineHeaderWidth: 80,
  });
  assert.ok(rows.length > 1);
  for (const row of rows) {
    assert.ok(row.measures.length <= 4);
    assert.ok(row.measures.every(item => item.width >= dense.minimumWidth));
    assert.ok(row.width <= 884);
  }
});

test('long chords at close beats retain their beats and have clear space', () => {
  const { spaceMeasure } = layoutApi();
  const chords = [{ beat: 1, width: 88 }, { beat: 1.25, width: 67 }, { beat: 3, width: 43 }];
  const input = { notes: melody(8), chords, beats: 4 };
  const before = structuredClone(input);
  const result = spaceMeasure(input);
  assert.deepEqual(input, before);
  for (let index = 1; index < chords.length; index++) {
    assert.ok(result.chordXs[index] - chords[index].width / 2 >= result.chordXs[index - 1] + chords[index - 1].width / 2 + 11.99);
  }
  assert.equal(result.chordXs[0], result.noteXs[0]);
  assert.ok(result.chordXs[1] > result.noteXs[0] && result.chordXs[1] < result.noteXs[1]);
  assert.ok(result.chordXs[0] >= chords[0].width / 2 + 9.99);
  assert.ok(result.chordXs[2] + chords[2].width / 2 <= result.width - 10);
});

test('wide lyrics and accidental extents remain separated when a row is justified', () => {
  const { spaceMeasure } = layoutApi();
  const input = { notes: [{ beat: 1, left: 35, right: 41 }, { beat: 1.5, left: 30, right: 25 }, { beat: 2, left: 8, right: 12 }], chords: [], beats: 4 };
  const minimum = spaceMeasure(input);
  const result = spaceMeasure(input, minimum.minimumWidth + 200);
  assert.equal(result.width, minimum.minimumWidth + 200);
  for (let index = 1; index < input.notes.length; index++) {
    assert.ok(result.noteXs[index] - input.notes[index].left >= result.noteXs[index - 1] + input.notes[index - 1].right + 11.99);
  }
});

test('first-line clef, key and time header are included before wrapping', () => {
  const { wrapMeasures } = layoutApi();
  const rows = wrapMeasures(Array.from({ length: 6 }, (_, index) => ({ id: String(index), minimumWidth: 210 })), {
    lineWidth: 884, maximumMeasures: 4, firstHeaderWidth: 120, lineHeaderWidth: 20,
  });
  assert.deepEqual(rows.map(row => row.measures.length), [3, 3]);
  assert.equal(rows[0].measures[0].headerWidth, 120);
  assert.equal(rows[1].measures[0].headerWidth, 20);
  assert.equal(rows[0].measures[1].headerWidth, 0);
  assert.deepEqual(rows.flatMap(row => row.measures.map(item => item.id)), ['0', '1', '2', '3', '4', '5']);
  assert.ok(rows.every(row => Math.abs(row.measures.reduce((sum, item) => sum + item.width, 0) - row.width) < .001));
});

test('one oversized measure owns a wider row without clipping or reordering', () => {
  const { wrapMeasures } = layoutApi();
  const input = [{ id: 'a', minimumWidth: 1200 }, { id: 'b', minimumWidth: 120 }, { id: 'c', minimumWidth: 120 }];
  const rows = wrapMeasures(input, { lineWidth: 884, maximumMeasures: 4, firstHeaderWidth: 120, lineHeaderWidth: 80 });
  assert.equal(rows[0].measures.length, 1);
  assert.equal(rows[0].width, 1320);
  assert.equal(rows[0].measures[0].width, 1320);
  assert.deepEqual(rows.flatMap(row => row.measures.map(item => item.id)), ['a', 'b', 'c']);
  assert.deepEqual(input, [{ id: 'a', minimumWidth: 1200 }, { id: 'b', minimumWidth: 120 }, { id: 'c', minimumWidth: 120 }]);
});

test('empty measures, duplicate chord beats and non-finite options never produce NaN', () => {
  const { spaceMeasure, wrapMeasures } = layoutApi();
  const empty = spaceMeasure({ notes: [], chords: [], beats: 4 }, Number.NaN);
  assert.ok(Number.isFinite(empty.width));
  assert.deepEqual(wrapMeasures([], { lineWidth: 884, maximumMeasures: 4, firstHeaderWidth: 0, lineHeaderWidth: 0 }), []);
  assert.throws(() => spaceMeasure({ notes: melody(4), chords: [{ beat: Number.NaN, width: 20 }], beats: 4 }), /finite|유효/);
  const simultaneous = spaceMeasure({ notes: melody(4), chords: [{ beat: 1, width: 20 }, { beat: 1, width: 30 }], beats: 4 });
  assert.deepEqual(simultaneous.chordRows, [0, 1]);
  assert.ok(Number.isFinite(simultaneous.width));
});


test('same-beat chords stack without changing their shared beat, symbols or input order', () => {
  const { spaceMeasure } = layoutApi();
  const input = { notes: melody(8), chords: [
    { beat: 1, width: 80, symbol: 'Badd2/D#' },
    { beat: 1, width: 40, symbol: 'C#m7' },
    { beat: 2, width: 50, symbol: 'F#7' },
    { beat: 2, width: 60, symbol: 'G#m7' },
    { beat: 2, width: 45, symbol: 'Emaj7' },
    { beat: 4, width: 30, symbol: 'E' },
  ], beats: 4 };
  const before = structuredClone(input);
  Object.freeze(input.chords);
  const result = spaceMeasure(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.chordRows, [0, 1, 0, 1, 2, 0]);
  assert.equal(result.chordRowCount, 3);
  assert.equal(result.chordXs[0], result.chordXs[1]);
  assert.equal(result.chordXs[2], result.chordXs[3]);
  assert.equal(result.chordXs[2], result.chordXs[4]);
  assert.equal(result.chordXs[0], result.noteXs[0]);
  assert.equal(result.chordXs[2], result.noteXs[2]);
  for (let row = 0; row < result.chordRowCount; row++) {
    const indices = result.chordRows.flatMap((assigned, index) => assigned === row ? [index] : []);
    for (let index = 1; index < indices.length; index++) {
      const previous = indices[index - 1];
      const current = indices[index];
      assert.ok(result.chordXs[current] - input.chords[current].width / 2 >= result.chordXs[previous] + input.chords[previous].width / 2 + 11.99);
    }
  }
});
