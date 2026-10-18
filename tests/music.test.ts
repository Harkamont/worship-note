import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { durationBeats, exportLyrics, exportMusicXML, getScoreStats, sectionLyrics, transposeChord, transposePitch, transposeScore, validateScore } from '../lib/music.ts';
import { createBlankScore, createSampleScore } from '../lib/sample.ts';
import type { Score } from '../lib/score-types.ts';

const copy = (): Score => structuredClone(createSampleScore());

test('rejects malicious chord text without excessive regular expression work', async () => {
  const moduleUrl = new URL('../lib/music.ts', import.meta.url).href;
  const program = `import { transposeChord } from ${JSON.stringify(moduleUrl)}; try { transposeChord('C' + '7'.repeat(38) + 'x', 1); process.exit(2); } catch { process.stdout.write('rejected'); }`;
  const result = await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program], { timeout: 2000 });
  assert.equal(result.stdout, 'rejected');
});

test('transposes chord roots and slash bass while preserving chord qualities', () => {
  assert.equal(transposeChord('C/E', 2), 'D/F#');
  assert.equal(transposeChord('F#m7b5/C#', 2), 'G#m7b5/D#');
  assert.equal(transposeChord('Bbmaj7/D', 2, true), 'Cmaj7/E');
  assert.equal(transposeChord('N.C.', 2), 'N.C.');
});

test('transposes a single parenthesized chord and rejects malformed whole-chord parentheses', () => {
  assert.equal(transposeChord('(Bm7)', 2), '(C#m7)');
  assert.equal(transposeChord('(F#m7(b5)/C#)', 2), '(G#m7(b5)/D#)');
  for (const symbol of ['(Bm7)F#7', '(Bm7)(Em7)', '((Bm7))', '(Bm7', 'Bm7)', '(C/E)/G']) assert.throws(() => transposeChord(symbol, 2));
});

test('exports added second and ninth degrees with their semantic alterations', () => {
  for (const [symbol, kind, value, alter] of [
    ['F#add2/C#', 'major', 2, 0], ['Cmaddb9', 'minor', 9, -1], ['Cm7(#9)', 'minor-seventh', 9, 1],
  ] as const) {
    const score = copy();
    score.sections[0].measures[0].chords[0].symbol = symbol;
    const xml = exportMusicXML(score).match(/<harmony>[\s\S]*?<\/harmony>/)![0];
    assert.match(xml, new RegExp(`<kind text="[^"]*">${kind}</kind>`));
    assert.match(xml, new RegExp(`<degree[^>]*><degree-value>${value}</degree-value><degree-alter>${alter}</degree-alter><degree-type>add</degree-type></degree>`));
  }
});

test('transposes notes across octave boundaries and rejects an invalid pitch', () => {
  assert.equal(transposePitch('B4', 1), 'C5');
  assert.equal(transposePitch('C4', -1), 'B3');
  assert.equal(transposePitch('A4', 1, true), 'Bb4');
  assert.throws(() => transposePitch('H4', 2));
});

test('transposes to a flat key without mutating the original score', () => {
  const original = copy();
  const moved = transposeScore(original, 'Bb');
  assert.equal(moved.key, 'Bb');
  assert.equal(moved.sections[0].measures[0].notes[0].pitch, 'Bb3');
  assert.equal(moved.sections[0].measures[0].chords[0].symbol, 'Bb');
  assert.equal(original.key, 'C');
  assert.equal(original.sections[0].measures[0].notes[0].pitch, 'C4');
});

test('preserves minor tonality when moving the tonic', () => {
  const score = copy();
  score.key = 'Am';
  score.sections[0].measures[0].chords[0].symbol = 'Am/E';
  const moved = transposeScore(score, 'Bm');
  assert.equal(moved.key, 'Bm');
  assert.equal(moved.sections[0].measures[0].chords[0].symbol, 'Bm/F#');
  assert.throws(() => transposeScore(score, 'B'), /minor|장조|단조|조성/i);
});

test('accepts a written minor mode with extra separating spaces', () => {
  const score = copy();
  score.key = 'A minor';
  assert.equal(transposeScore(score, 'B   minor').key, 'Bm');
});

test('normalizes imported key labels without changing notes or chord spellings', () => {
  for (const [input, expected] of [
    ['A major', 'A'], ['E minor', 'Em'], ['A   minor', 'Am'],
    [' G♭ major ', 'Gb'], ['C♯', 'C#'], ['E♭ minor', 'Ebm'],
  ]) {
    const score = copy();
    score.key = input;
    const validated = validateScore(score);
    assert.equal(validated.key, expected);
    assert.deepEqual(validated.sections, score.sections);
    assert.equal(score.key, input);
  }
});

test('offers all fifteen supported keys for each mode', async () => {
  const { KEY_OPTIONS } = await import('../lib/music.ts');
  assert.ok(KEY_OPTIONS, 'Key choices must come from the supported musical keys');
  for (const [mode, options] of Object.entries(KEY_OPTIONS)) {
    assert.equal(options.length, 15);
    assert.equal(new Set(options).size, 15);
    for (const key of options) {
      const score = copy();
      score.key = key;
      assert.equal(validateScore(score).key, key);
      assert.equal(key.endsWith('m'), mode === 'minor');
    }
  }
  for (const key of ['Cb', 'Gb', 'F#', 'C#']) assert.ok(KEY_OPTIONS.major.includes(key));
  for (const key of ['Abm', 'Ebm', 'G#m', 'D#m', 'A#m']) assert.ok(KEY_OPTIONS.minor.includes(key));
});

test('exports form order and repeats with optional section names', () => {
  const score = copy();
  score.form = [{ id: 'form-repeated', sectionId: score.sections[2].id, repeat: 2 }];
  const text = exportLyrics(score, { sectionNames: true });
  assert.equal(text.match(/\[C\]/g)?.length, 2);
  assert.equal(text.match(/감사해요/g)?.length, 2);
  const plain = exportLyrics(score, { sectionNames: false });
  assert.ok(!plain.includes('[C]'));
  assert.equal(plain.match(/감사해요/g)?.length, 2);
  assert.equal(sectionLyrics(score.sections[2]), '감사해요\n나의주님\n밝은노래\n주께드려');
});

test('omits instrumental sections unless explicitly included', () => {
  const score = copy();
  const intro = score.sections[0];
  intro.type = 'intro';
  intro.label = '전주';
  intro.measures.forEach((measure) => measure.notes.forEach((note) => { note.lyric = ''; }));
  score.form = [{ id: 'form-intro', sectionId: intro.id, repeat: 1 }];
  assert.equal(exportLyrics(score), '');
  assert.match(exportLyrics(score, { includeInstrumentals: true }), /\[전주\][\s\S]*연주/);
});

test('exports escaped MusicXML with notes, chords, key, tempo and played form', () => {
  const score = copy();
  score.title = '오늘 & 내일 <연습>';
  score.artist = '우리 "팀"';
  score.sections[0].measures[0].notes[0].lyric = '<오&늘>';
  score.sections[0].measures[0].chords[0].symbol = 'C/E';
  score.form = [{ id: 'form-xml', sectionId: score.sections[0].id, repeat: 2 }];
  const xml = exportMusicXML(score);
  assert.ok(xml.startsWith('<?xml'));
  assert.match(xml, /<score-partwise version="4.0">/);
  assert.match(xml, /오늘 &amp; 내일 &lt;연습&gt;/);
  assert.match(xml, /&lt;오&amp;늘&gt;/);
  assert.match(xml, /<bass-step>E<\/bass-step>/);
  assert.match(xml, /<fifths>0<\/fifths>/);
  assert.match(xml, /<sound tempo="84"/);
  assert.equal((xml.match(/<measure number=/g) ?? []).length, 8);
  assert.equal((xml.match(/<note>/g) ?? []).length, 32);
});

test('sample and blank scores validate with exact measure durations', () => {
  const sample = validateScore(createSampleScore());
  assert.equal(sample.title, '오늘의 찬양');
  assert.deepEqual(sample.sections.map((s) => s.label), ['V1', 'V2', 'C', 'B']);
  assert.deepEqual(getScoreStats(sample), { measures: 16, notes: 64, sections: 4 });
  for (const section of sample.sections) {
    assert.equal(section.measures.length, 4);
    for (const measure of section.measures) assert.equal(measure.notes.reduce((sum, note) => sum + durationBeats(note), 0), 4);
  }
  assert.equal(validateScore(createBlankScore()).source, 'manual');
});

test('exports no-chord markings with the hidden root required by MusicXML', () => {
  const score = createBlankScore();
  score.sections[0].measures[0].chords[0].symbol = 'N.C.';
  const text = exportMusicXML(score);
  assert.match(text, /<harmony><root><root-step text="">C<\/root-step><\/root><kind text="N.C.">none<\/kind>/);
  assert.match(text, /<rest\/><duration>16<\/duration>/);
});

test('handles dotted notes and ties on matching consecutive pitches', () => {
  const score = copy();
  const notes = score.sections[0].measures[0].notes;
  notes[0].dots = 1;
  notes[1].duration = '8';
  notes[1].pitch = notes[0].pitch;
  notes[0].tie = true;
  const validated = validateScore(score);
  assert.equal(durationBeats(validated.sections[0].measures[0].notes[0]), 1.5);
  const text = exportMusicXML(score);
  assert.match(text, /<duration>6<\/duration><tie type="start"\/>/);
  assert.match(text, /<duration>2<\/duration><tie type="stop"\/>/);
  notes[1].pitch = 'F4';
  assert.throws(() => validateScore(score), /붙임줄/);
});

test('rejects malformed AI JSON, invalid references, chords, lengths and unbounded data', () => {
  assert.throws(() => validateScore(null));
  assert.throws(() => validateScore({ title: 'AI result', sections: [] }));
  const mutations: Array<(score: Score) => void> = [
    (score) => { score.tempo = Number.NaN; },
    (score) => { score.title = 'x'.repeat(201); },
    (score) => { score.key = 'Z major'; },
    (score) => { score.form[0].sectionId = 'missing'; },
    (score) => { score.form[0].repeat = 1000; },
    (score) => { score.sections[0].measures[0].notes[0].pitch = 'H4'; },
    (score) => { score.sections[0].measures[0].notes[0].duration = 'h'; },
    (score) => { score.sections[0].measures[0].notes[0].lyric = '가'.repeat(121); },
    (score) => { score.sections[0].measures[0].chords[0].symbol = 'C<script>'; },
    (score) => { score.sections[0].measures[0].chords[0].beat = 0; },
    (score) => { score.sections[0].measures[0].chords[0].beat = 5; },
    (score) => { score.sections[0].measures[0].notes[0].id = score.sections[0].id; },
    (score) => { score.sections = Array.from({ length: 33 }, () => structuredClone(score.sections[0])); },
  ];
  for (const mutate of mutations) {
    const score = copy();
    mutate(score);
    assert.throws(() => validateScore(score));
  }
});
