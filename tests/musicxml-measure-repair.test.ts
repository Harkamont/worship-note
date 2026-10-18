import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMeasureRepair, createRepairContext, validateMergedRepair } from '../lib/musicxml-measure-repair.ts';

const attributes = '<attributes><divisions>4</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const note = (step = 'C', duration = 16, type = 'whole', extra = '') => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff>${extra}</note>`;
const bar = (number: string, body = note(), attrs = '') => `<measure number="${number}"${attrs}>${body}</measure>`;
const part = (bars: string, id = 'P1') => `<part id="${id}">${bars}</part>`;
const score = (bars: string, extraParts = '') => `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>원본 &amp; 악보</work-title></work><part-list><score-part id="P1"><part-name>선율</part-name></score-part></part-list>${part(bars)}${extraParts}</score-partwise>`;
const fragment = (bars: string, id = 'P1') => `<score-partwise version="4.0"><part-list><score-part id="${id}"><part-name>선율</part-name></score-part></part-list>${part(bars, id)}</score-partwise>`;
const selection = { partId: 'P1', startMeasure: 2, endMeasure: 2 };
const source = () => score(bar('0', attributes + note()) + '\n<!-- keep this untouched -->\n' + bar('A', note()) + '\n' + bar('A', note('E')), part(bar('1', attributes + note('G')), 'P2'));

test('bounds the request to selected ordinal measures and includes inherited notation without the full score', () => {
  const original = source();
  const context = createRepairContext(original, selection);
  assert.deepEqual(context.selection, selection);
  assert.equal(context.inheritedAttributes.divisions, 4);
  assert.deepEqual(context.inheritedAttributes.key, ['<key><fifths>2</fifths></key>']);
  assert.deepEqual(context.inheritedAttributes.time, ['<time><beats>4</beats><beat-type>4</beat-type></time>']);
  assert.deepEqual(context.inheritedAttributes.clef, ['<clef><sign>G</sign><line>2</line></clef>']);
  assert.equal(context.measures.length, 1);
  assert.equal(context.measures[0].ordinal, 2);
  assert.equal(context.measures[0].number, 'A');
  assert.equal(context.measures[0].events[0].pitchMidi, 60);
  assert.equal(context.measures[0].xml, bar('A'));
  assert.ok(!JSON.stringify(context).includes('원본'));
  assert.ok(!JSON.stringify(context).includes('P2'));
});

test('normalizes selection to its exact three supported fields so unrelated caller data never reaches the provider', () => {
  const input = { ...selection, unselectedXML: '<measure number="99">private extra data</measure>', clientState: { selected: false } };
  const context = createRepairContext(source(), input);
  assert.deepEqual(context.selection, selection);
  assert.ok(!JSON.stringify(context).includes('private extra data'));
  const result = applyMeasureRepair(source(), input, fragment(bar('A', note('D'))));
  assert.deepEqual(result.selection, selection);
});

test('replaces pitches, rhythms, harmony and lyrics only in the selected source spans', () => {
  const original = source();
  const harmony = '<harmony><root><root-step>D</root-step></root><kind>minor</kind></harmony>';
  const replacement = harmony + note('D', 8, 'half', '<lyric number="1"><text>고친 가사</text></lyric>') + note('F', 8, 'half');
  const result = applyMeasureRepair(original, selection, fragment(bar('A', replacement)), original);
  assert.equal(result.originalXML, original);
  assert.equal(result.xml, original.replace(bar('A'), bar('A', replacement)));
  assert.deepEqual(result.changedMeasureNumbers, ['A']);
  assert.equal(result.review.parts[0].measures[1].events[0].pitchMidi, 62);
  assert.equal(result.review.parts[1].measures[0].events[0].pitchMidi, 67);
  assert.equal(original, source());
});

test('keeps a leading BOM in immutable source and merged XML while parsing only a normalized copy', () => {
  const original = '\uFEFF' + source();
  assert.equal(createRepairContext(original, selection).measures[0].xml, bar('A'));
  const result = applyMeasureRepair(original, selection, '\uFEFF' + fragment(bar('A', note('D'))));
  assert.equal(result.originalXML, original);
  assert.equal(result.xml, original.replace(bar('A'), bar('A', note('D'))));
  assert.equal(result.review.xml, result.xml);
  assert.equal(validateMergedRepair(original, selection, result.xml).xml, result.xml);
});

test('keeps repeated/non-numeric measure numbers and replaces a contiguous selection in order', () => {
  const original = source();
  const chosen = { partId: 'P1', startMeasure: 2, endMeasure: 3 };
  const result = applyMeasureRepair(original, chosen, fragment(bar('A', note('D')) + bar('A', note('F'))));
  assert.deepEqual(result.review.parts[0].measures.map(measure => measure.number), ['0', 'A', 'A']);
  assert.deepEqual(result.review.parts[0].measures.map(measure => measure.events[0].pitchMidi), [60, 62, 65]);
});

test('rejects stale source snapshots before producing an applied result', () => {
  assert.throws(() => applyMeasureRepair(source(), selection, fragment(bar('A')), source() + '\n'), /변경|다시|원본/);
});

test('rejects invalid, unknown and too-wide selections without guessing measure numbers', () => {
  for (const chosen of [
    { ...selection, startMeasure: 0 }, { ...selection, startMeasure: 1.5 },
    { ...selection, endMeasure: 1 }, { ...selection, endMeasure: 4 },
    { ...selection, partId: 'missing' }, { ...selection, endMeasure: Number.NaN },
  ]) assert.throws(() => createRepairContext(source(), chosen));
  assert.throws(() => createRepairContext(score(Array.from({ length: 6 }, (_, index) => bar(String(index + 1), (index === 0 ? attributes : '') + note())).join('')), { ...selection, startMeasure: 1, endMeasure: 5 }), /4/);
});

test('rejects extra/omitted/reordered bars, foreign parts and malformed or unsafe repair XML', () => {
  const chosen = { ...selection, endMeasure: 3 };
  const numbered = score(bar('1', attributes + note()) + bar('2') + bar('3'));
  for (const repair of [fragment(bar('2')), fragment(bar('2') + bar('3') + bar('4')), fragment(bar('3') + bar('2')), fragment(bar('2') + bar('3'), 'P2'),
    fragment(bar('2') + bar('3')).replace('</score-partwise>', part(bar('2'), 'P2') + '</score-partwise>'),
    fragment(bar('2') + bar('3')).replace('</note>', '</wrong>'),
    '<!DOCTYPE score-partwise SYSTEM "https://example.test/score.dtd">' + fragment(bar('2') + bar('3')),
    fragment(bar('2') + bar('3')).replace('<step>C</step>', '<step>&external;</step>'),
    fragment(bar('2') + bar('3')).replace('<part id="P1">', '<part id="P1" id="P1">'),
  ]) assert.throws(() => applyMeasureRepair(numbered, chosen, repair));
});

test('ignores standard fragment header metadata without copying it into the immutable source', () => {
  const header = '<work><work-title>Provider title</work-title></work><movement-number>3</movement-number><movement-title>Provider movement</movement-title><identification><creator type="composer">Provider composer</creator></identification><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults><credit><credit-words>Provider credit</credit-words></credit>';
  const repair = fragment(bar('A', note('D'))).replace('<part-list>', header + '<part-list>');
  const result = applyMeasureRepair(source(), selection, repair);
  assert.equal(result.xml, source().replace(bar('A'), bar('A', note('D'))));
  assert.equal(result.review.title, '원본 & 악보');
  assert.ok(!result.xml.includes('Provider'));
  for (const extra of ['<unexpected/>', '<measure number="99"/>', '<score-timewise/>']) {
    assert.throws(() => applyMeasureRepair(source(), selection, repair.replace('<part-list>', extra + '<part-list>')), /파트|마디|XML/);
  }
  assert.throws(() => applyMeasureRepair(source(), selection, repair.replace('</score-partwise>', part(bar('A'), 'P2') + '</score-partwise>')), /파트|마디/);
});

test('rejects broken rhythm and never pads missing beats or truncates overfull music', () => {
  for (const repair of [
    fragment(bar('A', note('D', 8, 'half'))),
    fragment(bar('A', note('D') + note('D', 4, 'quarter'))),
    fragment(bar('A', note('D', 16, 'quarter'))),
    fragment(bar('A', note('D', 0))),
    fragment(bar('A', note('D', 8, 'half'), ' implicit="yes"')),
    fragment(bar('A', '')),
  ]) assert.throws(() => applyMeasureRepair(source(), selection, repair), /박|리듬|길이|implicit|못갖춘|음표/);
});

test('preserves selected measure metadata, directions, barlines and notation attributes', () => {
  const direction = '<direction><direction-type><words>느리게</words></direction-type><sound tempo="64"/></direction>';
  const ending = '<barline location="right"><repeat direction="backward"/></barline>';
  const original = score(bar('1', attributes + note()) + bar('2', direction + note() + ending, ' width="180"'));
  const chosen = { ...selection };
  const repaired = fragment(bar('2', direction + note('D') + ending, ' width="999"'));
  assert.equal(applyMeasureRepair(original, chosen, repaired).xml, original.replace(note() + ending, note('D') + ending));
  for (const repair of [fragment(bar('2', note('D') + ending)), fragment(bar('2', direction + note('D'))), fragment(bar('2', attributes.replace('<fifths>2</fifths>', '<fifths>5</fifths>') + direction + note('D') + ending))]) {
    assert.throws(() => applyMeasureRepair(original, chosen, repair), /보존|표시|조표|속성/);
  }
});

test('accepts inherited attributes repeated verbatim as context without leaking them into later measures', () => {
  const result = applyMeasureRepair(source(), selection, fragment(bar('A', attributes + note('D'))));
  assert.equal(result.xml, source().replace(bar('A'), bar('A', note('D'))));
});

test('accepts standalone inherited attributes around a source key-only change while preserving the source attribute block exactly', () => {
  const key = '<attributes><key><fifths>5</fifths></key></attributes>';
  const original = score(bar('1', attributes + note()) + bar('2', key + note()));
  for (const context of [attributes + key, attributes.replace('<key><fifths>2</fifths></key>', '<key><fifths>5</fifths></key>')]) {
    const result = applyMeasureRepair(original, selection, fragment(bar('2', context + note('D'))));
    assert.equal(result.xml, original.replace(key + note(), key + note('D')));
    assert.ok(result.review.issues.some(issue => issue.code === 'KEY_CHANGE'));
  }
  for (const context of [attributes + key.replace('<fifths>5</fifths>', '<fifths>6</fifths>'), key.replace('</attributes>', '<staves>2</staves></attributes>'), key.replace('</attributes>', '<clef><sign>F</sign><line>4</line></clef></attributes>')]) {
    assert.throws(() => applyMeasureRepair(original, selection, fragment(bar('2', context + note('D')))), /속성|보존|표시/);
  }
});

test('normalizes exact divisions conversions and equivalent single-staff key/clef metadata while restoring original split attributes and layout', () => {
  const split = '<attributes><divisions>4</divisions></attributes><attributes><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef></attributes>';
  const print = '<print new-system="yes"/>';
  const original = score(bar('1', print + split + note()) + bar('2'));
  const chosen = { ...selection, startMeasure: 1, endMeasure: 1 };
  const proposedAttributes = attributes.replace('<divisions>4</divisions>', '<divisions>10080</divisions>').replace('<fifths>2</fifths>', '<fifths>2</fifths><mode>major</mode>');
  const harmony = '<harmony><root><root-step>D</root-step></root><kind>major</kind><offset>10080</offset></harmony>';
  const result = applyMeasureRepair(original, chosen, fragment(bar('1', '<print><system-layout/></print>' + proposedAttributes + harmony + note('D', 40320))));
  assert.equal(result.xml, original.replace(print + split + note(), print + split + harmony.replace('<offset>10080</offset>', '<offset>4</offset>') + note('D')));
  assert.equal(result.review.parts[0].measures[0].events[0].durationQuarterBeats, 4);
  assert.equal(result.review.parts[0].measures[0].chords[0].onsetQuarterBeats, 1);
  assert.ok(!result.xml.includes('10080'));
  assert.ok(!result.xml.includes('system-layout'));
});

test('rejects fractional rescaling and real key, clef or meter changes instead of normalizing them away', () => {
  const original = score(bar('1', attributes + note()) + bar('2'));
  const chosen = { ...selection, startMeasure: 1, endMeasure: 1 };
  for (const proposed of [
    attributes.replace('<divisions>4</divisions>', '<divisions>3</divisions>') + note('D', 1, 'quarter'),
    attributes.replace('<fifths>2</fifths>', '<fifths>3</fifths>') + note('D'),
    attributes.replace('<sign>G</sign>', '<sign>F</sign>') + note('D'),
    attributes.replace('<beats>4</beats>', '<beats>3</beats>') + note('D'),
  ]) assert.throws(() => applyMeasureRepair(original, chosen, fragment(bar('1', proposed))), /정수|속성|보존|조표|박자|음자리표/);
});

test('converts inherited provider divisions across several measures including backup without changing simultaneous voices', () => {
  const polyphony = (first = 'C', second = 'E', duration = 16) => note(first, duration) + `<backup><duration>${duration}</duration></backup>` + note(second, duration).replace('<voice>1</voice>', '<voice>2</voice>');
  const original = score(bar('1', attributes + polyphony()) + bar('2', polyphony()));
  const chosen = { ...selection, startMeasure: 1, endMeasure: 2 };
  const repair = fragment(bar('1', attributes.replace('<divisions>4</divisions>', '<divisions>10080</divisions>') + polyphony('D', 'F', 40320)) + bar('2', polyphony('E', 'G', 40320)));
  const result = applyMeasureRepair(original, chosen, repair);
  assert.deepEqual(result.review.parts[0].measures.map(measure => measure.durationQuarterBeats), [4, 4]);
  assert.deepEqual(result.review.parts[0].measures.map(measure => measure.events.map(event => [event.voice, event.onsetQuarterBeats])), [[['1', 0], ['2', 0]], [['1', 0], ['2', 0]]]);
  assert.ok(!result.xml.includes('40320'));
  assert.match(result.xml, /<backup><duration>16<\/duration><\/backup>/);
});

test('does not move a selected note to another source voice or staff merely because that stream exists elsewhere', () => {
  const original = score(bar('1', attributes + '<attributes><staves>2</staves></attributes>' + note() + '<backup><duration>16</duration></backup>' + note('E').replace('<voice>1</voice>', '<voice>2</voice>').replace('<staff>1</staff>', '<staff>2</staff>')) + bar('2'));
  for (const changed of [note('D').replace('<voice>1</voice>', '<voice>2</voice>'), note('D').replace('<staff>1</staff>', '<staff>2</staff>')]) {
    assert.throws(() => applyMeasureRepair(original, selection, fragment(bar('2', changed))), /성부|보표/);
  }
});

test('allows pitch correction in an existing short bar only when its full timing skeleton is unchanged and keeps the warning', () => {
  const original = score(bar('1', attributes + note('C', 4, 'quarter')) + bar('2'));
  const chosen = { ...selection, startMeasure: 1, endMeasure: 1 };
  const result = applyMeasureRepair(original, chosen, fragment(bar('1', attributes + note('D', 4, 'quarter'), ' implicit="no"')));
  assert.equal(result.xml, original.replace(note('C', 4, 'quarter'), note('D', 4, 'quarter')));
  assert.ok(result.review.issues.some(issue => issue.code === 'MEASURE_UNDERFULL' && issue.measure === '1'));
  assert.equal(result.review.parts[0].measures[0].implicit, false);
  for (const proposed of [note('D', 2, 'eighth'), note('D', 2, 'eighth') + note('E', 2, 'eighth')]) {
    assert.throws(() => applyMeasureRepair(original, chosen, fragment(bar('1', attributes + proposed))), /리듬|길이|박/);
  }
});

test('revalidates merged repair receipts against the immutable original and rejects forged unselected content or metadata', () => {
  const original = source();
  const applied = applyMeasureRepair(original, selection, fragment(bar('A', note('D'))));
  const result = validateMergedRepair(original, selection, applied.xml, original);
  assert.equal(result.xml, applied.xml);
  assert.equal(result.originalXML, original);
  for (const forged of [
    applied.xml.replace('<step>E</step>', '<step>G</step>'),
    applied.xml.replace('원본 &amp; 악보', '다른 제목'),
    applied.xml.replace(bar('A', note('D')), bar('A', note('D'), ' width="999"')),
    applied.xml.replace('<!-- keep this untouched -->', '<!-- changed -->'),
  ]) assert.throws(() => validateMergedRepair(original, selection, forged), /선택|원본|수정안|변경/);
  assert.throws(() => validateMergedRepair(original, selection, applied.xml, original + '\n'), /원본|변경/);
});

test('rejects new voices/staves and ambiguous duplicate source part IDs', () => {
  for (const repair of [fragment(bar('A', note('D').replace('<voice>1</voice>', '<voice>2</voice>'))), fragment(bar('A', note('D').replace('<staff>1</staff>', '<staff>2</staff>')))]) {
    assert.throws(() => applyMeasureRepair(source(), selection, repair), /성부|보표/);
  }
  assert.throws(() => createRepairContext(score(bar('1', attributes + note()), part(bar('1', attributes + note()))), { ...selection, startMeasure: 1, endMeasure: 1 }), /중복|파트/);
});

test('preserves genuine pickup length and forbids turning ordinary bars into pickups to pass validation', () => {
  const original = score(bar('0', attributes + note('C', 4, 'quarter'), ' implicit="yes"') + bar('1'));
  const chosen = { ...selection, startMeasure: 1, endMeasure: 1 };
  const repair = fragment(bar('0', attributes + note('D', 4, 'quarter'), ' implicit="yes"'));
  const result = applyMeasureRepair(original, chosen, repair);
  assert.equal(result.review.parts[0].measures[0].durationQuarterBeats, 1);
  assert.equal(result.review.parts[0].measures[0].events.length, 1);
  assert.throws(() => applyMeasureRepair(original, chosen, fragment(bar('0', attributes + note('D', 8, 'half'), ' implicit="yes"'))), /못갖춘|길이/);
});

test('removes only the app rhythm-review marker after a valid repair and permits an explicitly repaired pickup', () => {
  const marker = '<direction placement="above"><direction-type><words id="chanyang-review-m1-beats-1">리듬 검토 필요</words></direction-type></direction>';
  const original = score(bar('1', attributes + marker + note('C', 2, 'eighth'), ' implicit="no"') + bar('2'));
  const chosen = { ...selection, startMeasure: 1, endMeasure: 1 };
  const result = applyMeasureRepair(original, chosen, fragment(bar('1', attributes + note('D', 4, 'quarter'), ' implicit="yes"')));
  assert.ok(!result.xml.includes('chanyang-review-'));
  assert.equal(result.review.parts[0].measures[0].implicit, true);
  assert.equal(result.review.parts[0].measures[0].durationQuarterBeats, 1);
  assert.throws(() => applyMeasureRepair(original, chosen, fragment(bar('1', attributes + note('D', 2, 'eighth'), ' implicit="yes"'))), /길이|1박/);
  assert.throws(() => applyMeasureRepair(original, chosen, fragment(bar('1', attributes + note('D'), ' implicit="no"'))), /길이|1박/);
});

test('supplies neighboring tie requirements and rejects pitches/ties that would break unchanged adjacent bars', () => {
  const start = '<tie type="start"/>';
  const stop = '<tie type="stop"/>';
  const original = score(bar('1', attributes + note('C', 16, 'whole', start)) + bar('2', note('C', 16, 'whole', stop + start)) + bar('3', note('C', 16, 'whole', stop)));
  const context = createRepairContext(original, selection);
  assert.equal(context.boundaryTies.incoming[0].pitchMidi, 60);
  assert.equal(context.boundaryTies.outgoing[0].pitchMidi, 60);
  assert.doesNotThrow(() => applyMeasureRepair(original, selection, fragment(bar('2', note('C', 16, 'whole', stop + start)))));
  for (const repair of [fragment(bar('2', note('D', 16, 'whole', stop + start))), fragment(bar('2', note('C'))), fragment(bar('2', note('C', 16, 'whole', stop)))]) {
    assert.throws(() => applyMeasureRepair(original, selection, repair), /붙임줄/);
  }
});

test('rejects unmatched or non-contiguous tie chains within the selected bars', () => {
  const original = score(bar('1', attributes + note()) + bar('2') + bar('3'));
  const chosen = { ...selection, endMeasure: 3 };
  const start = '<tie type="start"/>';
  const stop = '<tie type="stop"/>';
  assert.doesNotThrow(() => applyMeasureRepair(original, chosen, fragment(bar('2', note('D', 16, 'whole', start)) + bar('3', note('D', 16, 'whole', stop)))));
  for (const repair of [
    fragment(bar('2', note('D', 16, 'whole', start)) + bar('3', note('E', 16, 'whole', stop))),
    fragment(bar('2', note('D', 16, 'whole', stop)) + bar('3')),
    fragment(bar('2', note('D', 8, 'half', start) + note('E', 8, 'half')) + bar('3', note('D', 16, 'whole', stop))),
  ]) assert.throws(() => applyMeasureRepair(original, chosen, repair), /붙임줄/);
});

test('rejects invalid harmony roots/staves and chord positions outside the actual measure', () => {
  for (const body of [
    '<harmony><root><root-step>H</root-step></root><kind>major</kind></harmony>',
    '<harmony><root><root-step>D</root-step></root><kind>major</kind><staff>0</staff></harmony>',
    '<harmony><root><root-step>D</root-step></root><kind>major</kind><offset>-1</offset></harmony>',
    '<harmony><root><root-step>D</root-step></root><kind>major</kind><offset>16</offset></harmony>',
  ]) assert.throws(() => applyMeasureRepair(source(), selection, fragment(bar('A', body + note()))), /코드|보표/);
});

test('limits selected context and repair bytes before returning provider context or candidate music', () => {
  const hugeLyric = '<lyric><text>' + '가'.repeat(50_000) + '</text></lyric>';
  const original = score(bar('1', attributes + note()) + bar('2', note('C', 16, 'whole', hugeLyric)));
  assert.throws(() => createRepairContext(original, selection), /128|크기|용량/);
  assert.throws(() => applyMeasureRepair(source(), selection, fragment(bar('A', note('C', 16, 'whole', hugeLyric)))), /128|크기|용량/);
});

test('repairs one bar while keeping pre-existing errors elsewhere reviewable', () => {
  const original = score(bar('1', attributes + note('C', 20, 'whole')) + bar('2') + bar('3'));
  const result = applyMeasureRepair(original, selection, fragment(bar('2', note('D'))));
  assert.ok(result.review.issues.some(issue => issue.code === 'MEASURE_OVERFULL' && issue.measure === '1'));
  assert.equal(result.review.parts[0].measures[1].events[0].pitchMidi, 62);
});
