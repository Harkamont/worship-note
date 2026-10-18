import test from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { analyzeMusicXML } from '../lib/musicxml-review.ts';

async function implementation() {
  const implementationModule = await import('../lib/musicxml-annotations.ts').catch(() => null);
  assert.ok(implementationModule, 'The structure-preserving MusicXML annotation module must exist');
  return implementationModule;
}
const attributes = '<attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef></attributes>';
const note = (step: string, duration = 2, extra = '', voice = '1', staff = '1') => `<note default-x="17">${extra}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>${staff}</staff></note>`;
const source = (body = `${attributes}${note('C', 2, '<tie type="start"/>')}<backup><duration>2</duration></backup>${note('E', 2, '', '2', '2')}<forward><duration>4</duration></forward><barline location="right"><repeat direction="backward"/></barline>`, more = '') => `<?xml version="1.0"?><score-partwise version="4.0"><work><work-number>7</work-number><work-title>원제</work-title></work><identification><creator type="composer">원작자</creator><creator type="lyricist">작사자</creator></identification><part-list><score-part id="P1"><part-name>원성부</part-name></score-part></part-list><part id="P1"><measure number="0" implicit="yes">${body}</measure>${more}</part></score-partwise>`;
const data = () => ({ title: '찬양 & 기도', artist: '새 작곡자', warnings: ['원본 음표를 확인해 주세요.'], measures: [{ index: 1, verses: [{ number: '1', syllables: ['주 ', ''] }, { number: '2', syllables: ['나 ', ''] }], chords: [{ beat: 4 / 3, symbol: 'F#m7(b5)/C#' }] }] });
const timing = (xml: string) => analyzeMusicXML(xml).parts.map(part => ({ ...part, measures: part.measures.map(measure => ({ ...measure, chords: [], events: measure.events.map(event => ({ ...event, lyrics: [] })) })) }));
function protectedTree(xml: string) {
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, trimValues: false, ignoreDeclaration: true });
  const omit = (entries: Record<string, unknown>[]): unknown[] => entries.filter(entry => !['harmony', 'lyric', 'work-title', 'movement-title'].some(name => Object.hasOwn(entry, name)) && !(Object.hasOwn(entry, 'creator') && (entry[':@'] as Record<string, string> | undefined)?.type === 'composer')).map(entry => Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, Array.isArray(value) ? omit(value) : value])));
  return omit(parser.parse(xml));
}

test('context exposes global 1-based measure and physical XML note indices without flattening voices or tuplets', async () => {
  const { createXMLAnnotationContext } = await implementation();
  const context = JSON.parse(createXMLAnnotationContext(source()));
  const measure = context.measures[0];
  assert.equal(measure.index, 1);
  assert.equal(measure.number, '0');
  assert.equal(measure.actualQuarterBeats, 1);
  assert.deepEqual(measure.notes.map((item: { index: number; pitchMidi: number; duration: number; onset: number; voice: string; staff: string; lyricEligible: boolean }) => [item.index, item.pitchMidi, item.duration, item.onset, item.voice, item.staff, item.lyricEligible]), [[1, 60, 1 / 3, 0, '1', '1', true], [2, 64, 1 / 3, 0, '2', '2', false]]);
});

test('merges multiple verses and fractional harmony offsets while preserving every nonannotation XML node', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const original = source();
  const merged = mergeMusicXMLAnnotations(original, data());
  assert.deepEqual(timing(merged), timing(original));
  assert.deepEqual(protectedTree(merged), protectedTree(original));
  const review = analyzeMusicXML(merged);
  assert.equal(review.title, '찬양 & 기도');
  assert.deepEqual(review.parts[0].measures[0].events[0].lyrics.map(lyric => [lyric.number, lyric.text]), [['1', '주 '], ['2', '나 ']]);
  assert.equal(review.parts[0].measures[0].events[1].lyrics.length, 0);
  assert.ok(Math.abs(review.parts[0].measures[0].chords[0].onsetQuarterBeats! - 1 / 3) < 1e-9);
  assert.deepEqual(review.parts[0].measures[0].chords[0].root, { step: 'F', alter: 1 });
  assert.deepEqual(review.parts[0].measures[0].chords[0].bass, { step: 'C', alter: 1 });
  assert.match(merged, /작사자/);
  assert.doesNotMatch(merged, /원본 음표를 확인/);
});

test('preserves existing syllabic and extension metadata and removes standalone engraving marks from new text', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const original = source(attributes + note('C', 2, '<lyric number="1" name="첫절"><syllabic>begin</syllabic><text>옛</text><extend type="start"/><end-line/></lyric>') + note('D'));
  const input = data(); input.measures[0].verses = [{ number: '1', syllables: ['새 ', '—'] }];
  input.measures[0].chords = [];
  const merged = mergeMusicXMLAnnotations(original, input);
  const events = analyzeMusicXML(merged).parts[0].measures[0].events;
  assert.equal(events[0].lyrics[0].text, '새 ');
  assert.equal(events[0].lyrics[0].syllabic, 'begin');
  assert.equal(events[0].lyrics[0].extend, true);
  assert.equal(events[0].lyrics[0].endLine, true);
  assert.equal(events[0].lyrics[0].name, '첫절');
  assert.equal(events[1].lyrics.length, 0);
});

test('uses actual source extent despite an incorrect meter and leaves existing semantic errors untouched', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const original = source(attributes.replace('<beats>4</beats>', '<beats>1</beats>') + note('C', 18));
  const input = data(); input.measures[0].verses = [{ number: '1', syllables: ['주'] }]; input.measures[0].chords = [{ beat: 3.5, symbol: 'Bb(add9)/F' }];
  const merged = mergeMusicXMLAnnotations(original, input);
  assert.deepEqual(timing(merged), timing(original));
  assert.deepEqual(analyzeMusicXML(merged).issues, analyzeMusicXML(original).issues);
  assert.equal(analyzeMusicXML(merged).parts[0].measures[0].chords[0].onsetQuarterBeats, 2.5);
});

test('rejects missing duplicate or extra measures, changed note counts, injected fields and invalid chord positions', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const bad: unknown[] = [];
  let input: ReturnType<typeof data> & { notes?: unknown[] } = data(); input.measures = []; bad.push(input);
  input = data(); input.measures.push(input.measures[0]); bad.push(input);
  input = data(); input.measures[0].index = 2; bad.push(input);
  input = data(); Object.assign(input.measures[0], { notes: [] }); bad.push(input);
  input = data(); input.notes = []; bad.push(input);
  input = data(); input.measures[0].verses[0].syllables.pop(); bad.push(input);
  input = data(); input.measures[0].verses[0].syllables[1] = '반주'; bad.push(input);
  input = data(); input.measures[0].verses.push(input.measures[0].verses[0]); bad.push(input);
  input = data(); input.measures[0].chords[0].beat = 2; bad.push(input);
  input = data(); input.measures[0].chords[0].beat = NaN; bad.push(input);
  input = data(); input.measures[0].chords[0].symbol = 'C </kind><note/>'; bad.push(input);
  for (const invalid of bad) assert.throws(() => mergeMusicXMLAnnotations(source(), invalid));
});

test('keeps whole-chord parentheses in display overrides while preserving semantic root, kind and slash bass', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const original = source(attributes + note('C', 6));
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
  for (const [symbol, root, kind, rootText, kindText, bassText] of [
    ['(Bm7)', 'B', 'minor-seventh', '(B', 'm7)', undefined],
    ['(D)', 'D', 'major', '(D', ')', undefined],
    ['(Bm7/G)', 'B', 'minor-seventh', '(B', 'm7', 'G)'],
    ['(F#m7/C#)', 'F', 'minor-seventh', '(F', 'm7', 'C#)'],
  ] as const) {
    const input = { title: null, artist: null, warnings: [], measures: [{ index: 1, verses: [], chords: [{ beat: 1, symbol }] }] };
    const merged = mergeMusicXMLAnnotations(original, input);
    const harmony = parser.parse(merged)['score-partwise'].part.measure.harmony;
    assert.equal(harmony.root['root-step']['#text'], root); assert.equal(harmony.root['root-step']['@_text'], rootText);
    assert.equal(harmony.kind['#text'], kind); assert.equal(harmony.kind['@_text'], kindText);
    if (bassText) assert.equal(harmony.bass['bass-step']['@_text'], bassText);
    if (symbol.includes('/C#')) { assert.equal(harmony.bass['bass-alter']['#text'], '1'); assert.equal(harmony.bass['bass-alter']['@_print-object'], 'no'); }
    assert.equal(harmony['@_type'], undefined); assert.deepEqual(timing(merged), timing(original));
  }
  const nc = mergeMusicXMLAnnotations(original, { title: null, artist: null, warnings: [], measures: [{ index: 1, verses: [], chords: [{ beat: 1, symbol: '(N.C.)' }] }] });
  assert.match(nc, /text="\(N\.C\.\)"/);
  for (const symbol of ['(Bm7)F#7', '(Bm7)(Em7)', '((Bm7))', '(Bm7', 'Bm7)', '(C/E)/G']) assert.throws(() => mergeMusicXMLAnnotations(original, { title: null, artist: null, warnings: [], measures: [{ index: 1, verses: [], chords: [{ beat: 1, symbol }] }] }));
});

test('retains existing secondary, chord-tone and grace lyrics while editing only the primary lyric stream', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const lyric = (value: string) => `<lyric number="1"><syllabic>single</syllabic><text>${value}</text><extend type="start"/></lyric>`;
  const original = source(attributes + note('C') + '<backup><duration>2</duration></backup>' + note('E', 2, '', '2', '2').replace('</note>', lyric('보조') + '</note>') + note('G', 2, '<chord/>').replace('</note>', lyric('화음') + '</note>') + `<note><grace/><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff>${lyric('꾸밈')}</note>`);
  const merged = mergeMusicXMLAnnotations(original, { title: null, artist: null, warnings: [], measures: [{ index: 1, verses: [{ number: '1', syllables: ['주', '', '', ''] }], chords: [] }] });
  const before = analyzeMusicXML(original).parts[0].measures[0].events;
  const after = analyzeMusicXML(merged).parts[0].measures[0].events;
  assert.equal(after[0].lyrics[0].text, '주');
  assert.deepEqual(after.slice(1).map(event => event.lyrics), before.slice(1).map(event => event.lyrics));
  assert.deepEqual(timing(merged), timing(original));
});

test('maps common parenthesized qualities and added or suspended degrees to standard MusicXML harmony semantics', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const original = source(attributes + note('C', 6));
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
  for (const [symbol, kind, expectedDegree] of [
    ['F#m7(b5)/C#', 'half-diminished', undefined],
    ['Gadd2/A', 'major', ['2', '0', 'add']],
    ['C7sus4', 'suspended-fourth', ['7', '-1', 'add']],
    ['C7(b9)', 'dominant', ['9', '-1', 'add']],
    ['F#(b9)', 'major', ['9', '-1', 'add']],
    ['Cmaj7(#11)', 'major-seventh', ['11', '1', 'add']],
  ] as const) {
    const merged = mergeMusicXMLAnnotations(original, { title: null, artist: null, warnings: [], measures: [{ index: 1, verses: [], chords: [{ beat: 1, symbol }] }] });
    const harmony = parser.parse(merged)['score-partwise'].part.measure.harmony;
    assert.equal(harmony.kind['#text'], kind);
    if (expectedDegree) assert.deepEqual([harmony.degree['degree-value'], harmony.degree['degree-alter'], harmony.degree['degree-type']], expectedDegree);
    else assert.equal(harmony.degree, undefined);
    assert.deepEqual(timing(merged), timing(original));
  }
});

test('chooses treble melody across the part rather than the first bass event and marks one highest nonchord note per onset', async () => {
  const { createXMLAnnotationContext, mergeMusicXMLAnnotations } = await implementation();
  const atOctave = (xml: string, octave: number) => xml.replace('<octave>4</octave>', `<octave>${octave}</octave>`);
  const backup = '<backup><duration>2</duration></backup>';
  const first = attributes + atOctave(note('C', 2, '', '5', '2'), 3) + backup + atOctave(note('C'), 5) + backup + atOctave(note('E'), 5) + atOctave(note('G', 2, '<chord/>'), 6) + backup + note('A', 2, '', '2', '1');
  const second = atOctave(note('D'), 5) + backup + note('B', 2, '', '2', '1') + backup + atOctave(note('G', 2, '', '5', '2'), 3);
  const original = source(first, `<measure number="1">${second}</measure>`);
  const context = JSON.parse(createXMLAnnotationContext(original)) as { measures: { index: number; lyricStaff: string; lyricVoice: string; notes: { lyricEligible: boolean }[] }[] };
  assert.deepEqual(context.measures.map(measure => [measure.lyricStaff, measure.lyricVoice]), [['1', '1'], ['1', '1']]);
  assert.deepEqual(context.measures[0].notes.map(note => note.lyricEligible), [false, false, true, false, false]);
  assert.deepEqual(context.measures[1].notes.map(note => note.lyricEligible), [true, false, false]);
  const merged = mergeMusicXMLAnnotations(original, { title: null, artist: null, warnings: [], measures: context.measures.map(measure => ({ index: measure.index, verses: [{ number: '1', syllables: measure.notes.map(note => note.lyricEligible ? '주' : '') }], chords: [] })) });
  assert.deepEqual(analyzeMusicXML(merged).parts[0].measures[0].events.map(event => event.lyrics.map(lyric => lyric.text)), [[], [], ['주'], [], []]);
  assert.deepEqual(timing(merged), timing(original));
});

test('melody voice ranking prefers measure coverage, then median pitch, with the smallest positive staff as fallback', async () => {
  const { createXMLAnnotationContext } = await implementation();
  const backup = '<backup><duration>2</duration></backup>';
  const high = (voice: string) => note('C', 2, '', voice).replace('<octave>4</octave>', '<octave>6</octave>');
  const coverage = source(attributes + note('C') + backup + high('2'), `<measure number="1">${note('D')}</measure>`);
  const coverageContext = JSON.parse(createXMLAnnotationContext(coverage));
  assert.equal(coverageContext.measures[0].lyricVoice, '1');
  const median = source(attributes + note('C') + backup + high('2'), `<measure number="1">${note('D')}${backup}${high('2')}</measure>`);
  assert.equal(JSON.parse(createXMLAnnotationContext(median)).measures[0].lyricVoice, '2');
  const fallback = source(attributes.replace('<staves>2</staves>', '<staves>3</staves>') + high('5').replace('<staff>1</staff>', '<staff>3</staff>') + backup + note('C', 2, '', '1', '2'));
  assert.equal(JSON.parse(createXMLAnnotationContext(fallback)).measures[0].lyricStaff, '2');
});

test('requires rest, grace and simultaneous additional chord-tone lyric slots to remain blank', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const body = attributes + '<note><rest/><duration>2</duration><voice>1</voice><type>eighth</type></note>' + note('C') + note('E', 2, '<chord/>') + '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type></note>';
  const input = data(); input.measures[0].verses = [{ number: '1', syllables: ['', '주', '', ''] }]; input.measures[0].chords = [];
  assert.doesNotThrow(() => mergeMusicXMLAnnotations(source(body), input));
  for (const position of [0, 2, 3]) {
    const invalid = structuredClone(input); invalid.measures[0].verses[0].syllables[position] = '잘못';
    assert.throws(() => mergeMusicXMLAnnotations(source(body), invalid));
  }
});

test('global indices distinguish repeated printed measure numbers and measures in separate parts', async () => {
  const { createXMLAnnotationContext, mergeMusicXMLAnnotations } = await implementation();
  const original = source(attributes + note('C'), '<measure number="0">' + note('D') + '</measure>').replace('</score-partwise>', '<part id="P2"><measure number="0">' + attributes + note('E') + '</measure></part></score-partwise>');
  const context = JSON.parse(createXMLAnnotationContext(original));
  assert.deepEqual(context.measures.map((measure: { index: number }) => measure.index), [1, 2, 3]);
  const input = { title: null, artist: null, warnings: [], measures: [1, 2, 3].map(index => ({ index, verses: [{ number: '2', syllables: ['가'] }], chords: [] })) };
  const merged = mergeMusicXMLAnnotations(original, input);
  assert.deepEqual(timing(merged), timing(original));
  assert.equal(analyzeMusicXML(merged).noteCount, 3);
});

test('rejects unsafe XML and output over 2MiB, while exposing a strict annotation-only schema and prompt', async () => {
  const { createXMLAnnotationContext, mergeMusicXMLAnnotations, XML_ANNOTATION_JSON_SCHEMA, XML_ANNOTATION_PROMPT } = await implementation();
  assert.throws(() => createXMLAnnotationContext(source().replace('</note>', '</wrong>')));
  assert.throws(() => mergeMusicXMLAnnotations('<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "file:///private">]>' + source(), data()));
  assert.equal(XML_ANNOTATION_JSON_SCHEMA.additionalProperties, false);
  assert.match(XML_ANNOTATION_PROMPT, /image|이미지/);
  assert.match(XML_ANNOTATION_PROMPT, /추측|guess|memory/);
  const padding = '<defaults><scaling><description>' + 'a'.repeat(2 * 1024 * 1024 - new TextEncoder().encode(source()).length - 90) + '</description></scaling></defaults>';
  const nearLimit = source().replace('<part-list>', padding + '<part-list>');
  const input = data(); input.title = '가'.repeat(200); input.artist = '나'.repeat(200);
  assert.throws(() => mergeMusicXMLAnnotations(nearLimit, input), /2MB|크기|길이/);
});

test('places harmony after leading repeat barlines and attributes and respects inherited or changing divisions', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const original = source('<barline location="left"><repeat direction="forward"/></barline>' + attributes + note('C'), '<measure number="2">' + note('D') + '<attributes><divisions>12</divisions></attributes>' + note('E', 4) + '</measure><measure number="3">' + note('F', 4) + '</measure>');
  const input = { title: null, artist: null, warnings: [], measures: [1, 2, 3].map(index => ({ index, verses: [], chords: [{ beat: 1.25, symbol: 'C7sus4' }] })) };
  const merged = mergeMusicXMLAnnotations(original, input);
  assert.deepEqual(timing(merged), timing(original));
  for (const measure of analyzeMusicXML(merged).parts[0].measures) assert.equal(measure.chords[0].onsetQuarterBeats, .25);
});

test('keeps safe external DTD inputs, XML namespaces and metadata unrelated to title or composer', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const original = source(attributes + note('C')).replace('<score-partwise', '<!DOCTYPE score-partwise SYSTEM "https://example.com/musicxml.dtd"><score-partwise').replace(/<(\/?)([\w-]+)(?=[\s/>])/g, (whole, slash, tag) => tag === 'xml' ? whole : `<${slash}m:${tag}`).replace('<m:score-partwise ', '<m:score-partwise xmlns:m="http://www.musicxml.org/ns/musicxml" ');
  const input = { title: '바꾼 제목', artist: '작곡자', warnings: [], measures: [{ index: 1, verses: [{ number: '1', syllables: ['주 '] }], chords: [{ beat: 1.1, symbol: 'Cmaj7(#11)/G' }] }] };
  const merged = mergeMusicXMLAnnotations(original, input);
  assert.deepEqual(timing(merged), timing(original));
  assert.match(merged, /m:lyric/);
  assert.match(merged, /m:harmony/);
  assert.match(merged, /작사자/);
});

test('can add a printed title and composer when the source has no metadata containers', async () => {
  const { mergeMusicXMLAnnotations } = await implementation();
  const original = source(attributes + note('C')).replace(/<work>.*?<\/work><identification>.*?<\/identification>/, '');
  const input = data(); input.measures[0].verses = [{ number: '1', syllables: ['주'] }]; input.measures[0].chords = [];
  assert.equal(analyzeMusicXML(mergeMusicXMLAnnotations(original, input)).title, input.title);
});
