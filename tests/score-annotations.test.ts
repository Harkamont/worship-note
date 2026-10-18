import assert from 'node:assert/strict';
import test from 'node:test';
import { validateScore } from '../lib/music.ts';
import type { Score } from '../lib/score-types.ts';

const api = await import('../lib/score-annotations.ts').catch(() => null);
function moduleApi() { assert.ok(api, 'score annotation module must exist'); return api; }
function original(): Score {
  return {
    version: 1, title: '원래 제목', artist: '원래 작곡가', key: 'Bb', timeSignature: '4/4', tempo: 96,
    sections: [
      { id: 's1', label: '1절', type: 'verse', measures: [
        { id: 'm1', notes: [
          { id: 'n1', pitch: 'C#4', duration: 'q', dots: 1, lyric: '기', tie: true },
          { id: 'n2', pitch: 'C#4', duration: '8', dots: 0, lyric: '존', tie: false },
          { id: 'n3', pitch: null, duration: 'h', dots: 0, lyric: '', tie: false },
        ], chords: [{ id: 'c1', beat: 1, symbol: 'Bb' }] },
        { id: 'm2', notes: [{ id: 'n4', pitch: 'Bb3', duration: 'w', dots: 0, lyric: '말', tie: false }], chords: [] },
      ] },
      { id: 's2', label: '후렴', type: 'chorus', measures: [
        { id: 'm3', notes: [
          { id: 'n5', pitch: 'G4', duration: 'h', dots: 1, lyric: '가', tie: false },
          { id: 'n6', pitch: 'F4', duration: 'q', dots: 0, lyric: '사', tie: false },
        ], chords: [{ id: 'c2', beat: 4, symbol: 'F7' }] },
      ] },
    ],
    form: [{ id: 'f1', sectionId: 's2', repeat: 2 }, { id: 'f2', sectionId: 's1', repeat: 1 }, { id: 'f3', sectionId: 's2', repeat: 1 }],
    warnings: ['원본에서 음표를 확인했습니다.'], source: 'manual',
  };
}
function annotations() {
  return {
    title: '수정 제목' as string | null, artist: '수정 작곡가' as string | null,
    warnings: ['첫 마디 코드 확인이 필요합니다.'],
    measures: [
      { measureId: 'm3', lyrics: ['사', '랑'], chords: [{ beat: 1, symbol: 'C/E' }] },
      { measureId: 'm1', lyrics: ['하', '나', ''], chords: [{ beat: 1, symbol: 'Dm7' }, { beat: 2.75, symbol: 'G7/B' }] },
      { measureId: 'm2', lyrics: ['님'], chords: [] },
    ],
  };
}
function reject(score: unknown, patch: unknown) {
  const { mergeScoreAnnotations } = moduleApi();
  assert.throws(() => mergeScoreAnnotations(score, patch));
}
function freezeDeep(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
}

test('merges annotations by measure ID while preserving notation, structure, order and inputs', () => {
  const { mergeScoreAnnotations } = moduleApi();
  const score = original();
  const patch = annotations();
  const before = structuredClone(score);
  const patchBefore = structuredClone(patch);
  freezeDeep(score);
  freezeDeep(patch);
  const merged = mergeScoreAnnotations(score, patch);
  assert.deepEqual(score, before);
  assert.deepEqual(patch, patchBefore);
  assert.notEqual(merged, score);
  assert.equal(merged.title, patch.title);
  assert.equal(merged.artist, patch.artist);
  assert.equal(merged.source, 'ai');
  assert.deepEqual(merged.warnings, [...score.warnings, ...patch.warnings]);
  assert.deepEqual(merged.form, score.form);
  const expected = structuredClone(before);
  expected.title = patch.title!;
  expected.artist = patch.artist!;
  expected.source = 'ai';
  expected.warnings.push(...patch.warnings);
  for (const section of expected.sections) for (const measure of section.measures) {
    const update = patch.measures.find(item => item.measureId === measure.id)!;
    measure.notes.forEach((note, index) => { note.lyric = update.lyrics[index]; });
    measure.chords = merged.sections.flatMap(item => item.measures).find(item => item.id === measure.id)!.chords;
    assert.deepEqual(measure.chords.map(({ beat, symbol }) => ({ beat, symbol })), update.chords);
  }
  assert.deepEqual(merged, expected);
  assert.deepEqual(validateScore(merged), merged);
  merged.sections[0].measures[0].notes[0].lyric = '수정';
  merged.form[0].repeat = 3;
  merged.warnings.push('추가');
  assert.deepEqual(score, before);
});

test('null title and artist retain originals and an explicit empty artist is accepted', () => {
  const { mergeScoreAnnotations } = moduleApi();
  const patch = annotations();
  patch.title = null;
  patch.artist = null;
  const merged = mergeScoreAnnotations(original(), patch);
  assert.equal(merged.title, original().title);
  assert.equal(merged.artist, original().artist);
  patch.artist = '';
  assert.equal(mergeScoreAnnotations(original(), patch).artist, '');
});

test('validates the input score before inspecting the annotation patch', () => {
  const { mergeScoreAnnotations } = moduleApi();
  const patch = new Proxy({}, { ownKeys() { throw new Error('patch was inspected'); }, get() { throw new Error('patch was inspected'); } });
  assert.throws(() => mergeScoreAnnotations({ ...original(), version: 2 }, patch), /악보 버전/);
  const invalid = original();
  invalid.sections[0].measures[0].notes[0].pitch = 'invalid';
  reject(invalid, annotations());
});

test('rejects all root shape changes, missing fields and forbidden structural edits', () => {
  for (const patch of [null, [], 'text', 1, {}, { ...annotations(), sections: [] }, { ...annotations(), key: 'C' }, { ...annotations(), tempo: 120 }, { ...annotations(), timeSignature: '3/4' }, { ...annotations(), form: [] }, { ...annotations(), source: 'manual' }, { ...annotations(), notes: [] }]) reject(original(), patch);
  for (const field of Object.keys(annotations())) {
    const patch: Record<string, unknown> = annotations();
    delete patch[field];
    reject(original(), patch);
  }
});

test('rejects every unknown or missing measure/chord field including supplied IDs and notation', () => {
  for (const field of ['id', 'notes', 'pitch', 'duration', 'dots', 'tie', 'sectionId', 'unexpected']) {
    const patch = annotations();
    Object.assign(patch.measures[0], { [field]: field === 'notes' ? [] : 'malicious' });
    reject(original(), patch);
  }
  for (const field of ['measureId', 'lyrics', 'chords']) {
    const patch = annotations();
    delete (patch.measures[0] as Record<string, unknown>)[field];
    reject(original(), patch);
  }
  for (const field of ['id', 'notes', 'pitch', 'duration', 'dots', 'tie', 'measureId', 'unexpected']) {
    const patch = annotations();
    Object.assign(patch.measures[0].chords[0], { [field]: 'malicious' });
    reject(original(), patch);
  }
  for (const field of ['beat', 'symbol']) {
    const patch = annotations();
    delete (patch.measures[0].chords[0] as Record<string, unknown>)[field];
    reject(original(), patch);
  }
});

test('requires each existing measure exactly once and rejects extra, duplicate or missing IDs', () => {
  const missing = annotations(); missing.measures.pop(); reject(original(), missing);
  const extra = annotations(); extra.measures.push({ measureId: 'invented', lyrics: [], chords: [] }); reject(original(), extra);
  const duplicate = annotations(); duplicate.measures[2] = structuredClone(duplicate.measures[0]); reject(original(), duplicate);
  const replacement = annotations(); replacement.measures[2].measureId = 'invented'; reject(original(), replacement);
  for (const measureId of ['', ' ', 'x'.repeat(81), 'm1\u0000', 1, null]) {
    const patch = annotations();
    Object.assign(patch.measures[0], { measureId });
    reject(original(), patch);
  }
});

test('requires one bounded single-line lyric string per note and blank rest lyrics', () => {
  for (const lyrics of [[], ['one'], ['a', 'b', '', 'extra'], ['a', 'b', 'rest'], ['a', 'b', ' '], ['a\nb', 'b', ''], ['a\rb', 'b', ''], ['x'.repeat(121), 'b', ''], ['a\u0000', 'b', ''], [null, 'b', ''], [2, 'b', ''], Array(65).fill(''), null, {}]) {
    const patch = annotations();
    Object.assign(patch.measures[1], { lyrics });
    reject(original(), patch);
  }
});

test('rejects invalid chord symbols and beats instead of changing musical data', () => {
  for (const chord of [null, [], {}, { beat: 1, symbol: '' }, { beat: 1, symbol: 'H7' }, { beat: 1, symbol: 'C\nG' }, { beat: 1, symbol: 'C' + '7'.repeat(40) }, { beat: 0, symbol: 'C' }, { beat: 5, symbol: 'C' }, { beat: 1.1, symbol: 'C' }, { beat: Number.NaN, symbol: 'C' }, { beat: Number.POSITIVE_INFINITY, symbol: 'C' }, { beat: '1', symbol: 'C' }, { beat: 1, symbol: null }]) {
    const patch = annotations();
    Object.assign(patch.measures[0], { chords: [chord] });
    reject(original(), patch);
  }
  const tooMany = annotations();
  tooMany.measures[0].chords = Array.from({ length: 33 }, () => ({ beat: 1, symbol: 'C' }));
  reject(original(), tooMany);
});

test('bounds metadata and warnings without discarding original warnings', () => {
  for (const title of ['', ' ', 'x'.repeat(201), 3, [], 'bad\u0000']) reject(original(), { ...annotations(), title });
  for (const artist of ['x'.repeat(201), 3, [], 'bad\u0000']) reject(original(), { ...annotations(), artist });
  for (const warnings of [null, {}, ['x'.repeat(501)], [1], ['bad\u0000'], Array(101).fill('warning')]) reject(original(), { ...annotations(), warnings });
  const { mergeScoreAnnotations } = moduleApi();
  const score = original();
  score.warnings = Array.from({ length: 99 }, (_, index) => '원본 ' + index);
  const merged = mergeScoreAnnotations(score, annotations());
  assert.equal(merged.warnings.length, 100);
  assert.deepEqual(merged.warnings.slice(0, 99), score.warnings);
  score.warnings.push('원본 마지막 경고');
  reject(score, annotations());
});

test('rejects malformed collections, excessive measures and sparse arrays', () => {
  for (const measures of [null, {}, 'm1', Array(513).fill({ measureId: 'm1', lyrics: [], chords: [] }), Array(3)]) reject(original(), { ...annotations(), measures });
  for (const value of [null, [], 'measure']) {
    const patch = annotations();
    Object.assign(patch.measures, { 0: value });
    reject(original(), patch);
  }
  for (const chords of [null, {}, 'C', Array(1)]) {
    const patch = annotations();
    Object.assign(patch.measures[0], { chords });
    reject(original(), patch);
  }
  const sparseLyrics = annotations();
  sparseLyrics.measures[1].lyrics = Array(3);
  reject(original(), sparseLyrics);
  reject(original(), { ...annotations(), warnings: Array(1) });
});

test('creates unique chord IDs without colliding with any original score ID', () => {
  const { mergeScoreAnnotations } = moduleApi();
  const score = original();
  score.sections[0].id = 'annotation-chord-1';
  score.form[1].sectionId = score.sections[0].id;
  score.sections[0].measures[0].chords[0].id = 'annotation-chord-2';
  const oldIds = new Set<string>();
  for (const section of score.sections) {
    oldIds.add(section.id);
    for (const measure of section.measures) {
      oldIds.add(measure.id);
      for (const note of measure.notes) oldIds.add(note.id);
      for (const chord of measure.chords) oldIds.add(chord.id);
    }
  }
  score.form.forEach(entry => oldIds.add(entry.id));
  const merged = mergeScoreAnnotations(score, annotations());
  const chordIds = merged.sections.flatMap(section => section.measures.flatMap(measure => measure.chords.map(chord => chord.id)));
  assert.equal(new Set(chordIds).size, chordIds.length);
  assert.ok(chordIds.every(id => !oldIds.has(id)));
  assert.deepEqual(validateScore(merged), merged);
});

test('schema requires exactly the annotation fields and strict nested objects with bounded arrays', () => {
  const schema = moduleApi().ANNOTATION_JSON_SCHEMA;
  const root = schema as Record<string, unknown>;
  assert.deepEqual(root.required, ['title', 'artist', 'warnings', 'measures']);
  let objectCount = 0;
  function inspect(node: Record<string, unknown>) {
    if (node.type === 'object') {
      objectCount++;
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...(node.required as string[])].sort(), Object.keys(node.properties as object).sort());
    }
    for (const child of Object.values(node.properties as object ?? {})) inspect(child as Record<string, unknown>);
    if (node.items) inspect(node.items as Record<string, unknown>);
  }
  inspect(root);
  assert.equal(objectCount, 3);
  const properties = root.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(properties.title.type, ['string', 'null']);
  assert.deepEqual(properties.artist.type, ['string', 'null']);
  assert.equal(properties.title.maxLength, 200);
  assert.equal(properties.artist.maxLength, 200);
  assert.equal(properties.warnings.maxItems, 100);
  assert.equal(properties.measures.maxItems, 512);
  const measure = properties.measures.items as Record<string, unknown>;
  const fields = measure.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(fields).sort(), ['chords', 'lyrics', 'measureId']);
  assert.equal(fields.lyrics.maxItems, 64);
  assert.equal((fields.lyrics.items as Record<string, unknown>).maxLength, 120);
  assert.equal(fields.chords.maxItems, 32);
  const chord = fields.chords.items as Record<string, unknown>;
  assert.deepEqual(Object.keys(chord.properties as object).sort(), ['beat', 'symbol']);
  assert.equal((chord.properties as Record<string, Record<string, unknown>>).symbol.maxLength, 40);
});

test('schema chord pattern accepts one supported chord and rejects concatenated labels', () => {
  const pattern = moduleApi().ANNOTATION_JSON_SCHEMA.properties.measures.items.properties.chords.items.properties.symbol.pattern;
  const chord = new RegExp(pattern);
  const allowed = [
    'C', 'F#m7b5', 'C/E', 'F#7(b9)', 'Esus4', 'D#dim', 'Cmaj7', 'Cm7/B♭', 'F♯7(♭9)',
    'N.C.', 'N.C', 'NC.', 'NC', 'n.c.', 'nC', ' N.C. ', ' C/E ', '\tC\r\n',
    'Bb', 'A♭m', 'G♯aug', 'C♯', 'Cmin7', 'CM7', 'C°7', 'Cø7', 'CΔ7', 'C+7', 'C-7', 'C#b7', 'C♭♭7',
    'Cadd9', 'Comit3', 'Cno5', 'C7(#9,b13)', 'C7(♯9, ♭13)', 'C(7)(9)/F♯',
    'Cminmaj7', 'C( )', 'C(,)', 'C' + '7'.repeat(39),
  ];
  const rejected = [
    'F#(♭9)F#7', 'CAm', 'C Am', 'C G7', 'F#7(b9) F#7', 'C/EAm', 'C/E/G',
    'maj7', 'm7', 'sus4', 'H7', 'c7', 'C m7', 'C\tG', 'C\nG', 'C\rG',
    'C()', 'C((b9))', 'C7(b9', 'C7)b9(', 'C(9)F', 'C(9)/', 'C/#F', 'C/Am',
    'C7,9', 'C 7', 'N.C./C', 'N C', '', ' ',
    '\u000bC', 'C\u000c', 'C\u0000', 'C' + '7'.repeat(40),
    'C' + '7'.repeat(200_000) + '!',
  ];
  for (const symbol of allowed) {
    const score = original();
    score.sections[0].measures[0].chords[0].symbol = symbol;
    assert.doesNotThrow(() => validateScore(score), 'runtime must support ' + JSON.stringify(symbol));
    assert.equal(chord.test(symbol), true, 'schema must support ' + JSON.stringify(symbol));
  }
  for (const symbol of rejected) {
    const score = original();
    score.sections[0].measures[0].chords[0].symbol = symbol;
    assert.throws(() => validateScore(score), 'runtime must reject ' + JSON.stringify(symbol.slice(0, 80)));
    assert.equal(chord.test(symbol), false, 'schema must reject ' + JSON.stringify(symbol.slice(0, 80)));
  }
});

