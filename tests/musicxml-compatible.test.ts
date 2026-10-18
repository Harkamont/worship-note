import test from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { createCompatibleMusicXML } from '../lib/musicxml-compatible.ts';
import { analyzeMusicXML } from '../lib/musicxml-review.ts';

const attributes = '<attributes><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><key><fifths>1</fifths></key><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>';
const note = '<note id="n1"><type>whole</type><voice>1</voice><duration>16</duration><pitch><octave>4</octave><alter>1</alter><step>F</step></pitch><staff>1</staff><lyric number="2"><text>주 &amp; 나</text></lyric><lyric number="1"><text>Lord</text></lyric></note>';
const source = (body = attributes + note) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1">${body}</measure></part></score-partwise>`;
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, trimValues: false });
type Entry = Record<string, unknown>;
const tag = (entry: Entry) => Object.keys(entry).find(key => key !== ':@')!;
const children = (entries: Entry[], name: string) => entries.find(entry => tag(entry) === name)![name] as Entry[];
const tags = (entries: Entry[]) => entries.map(tag).filter(name => name !== '#text');
function measures(xml: string) { const root = children(parser.parse(xml), 'score-partwise'); return children(children(root, 'part'), 'measure'); }

test('reorders only attributes, note and pitch children while preserving every physical event and lyric', () => {
  const original = source(attributes + '<harmony><root><root-step>D</root-step></root><kind text="m7">minor-seventh</kind></harmony>' + note + '<backup><duration>16</duration></backup>' + note.replace('n1', 'n2').replace('<voice>1</voice>', '<voice>2</voice>'));
  const output = createCompatibleMusicXML(original);
  assert.notEqual(output, original);
  assert.deepEqual(tags(measures(output)), tags(measures(original)));
  assert.deepEqual(tags(children(measures(output), 'attributes')), ['divisions', 'key', 'time', 'staves', 'clef']);
  assert.deepEqual(tags(children(measures(output), 'note')), ['pitch', 'duration', 'voice', 'type', 'staff', 'lyric', 'lyric']);
  assert.deepEqual(tags(children(children(measures(output), 'note'), 'pitch')), ['step', 'alter', 'octave']);
  const before = analyzeMusicXML(original); const after = analyzeMusicXML(output);
  assert.deepEqual(after.parts[0].measures[0].events, before.parts[0].measures[0].events);
  assert.deepEqual(after.parts[0].measures[0].chords, before.parts[0].measures[0].chords);
  assert.equal(after.lyricsText, before.lyricsText); assert.deepEqual(after.lyricVerses, before.lyricVerses);
  assert.equal(createCompatibleMusicXML(output), output);
});

test('keeps unknown containers, namespaced extensions, comments and same-rank item order untouched', () => {
  const extension = '<extension><note><duration>3</duration><pitch><octave>8</octave><step>A</step></pitch></note></extension>';
  const original = source(attributes + note.replace('<staff>1</staff>', '<staff>1</staff><x:metadata xmlns:x="urn:private"><x:pitch><x:octave>7</x:octave><x:step>D</x:step></x:pitch></x:metadata><!--keep-->')).replace('<part-list>', extension + '<part-list>');
  const output = createCompatibleMusicXML(original);
  assert.ok(output.includes(extension));
  assert.match(output, /<x:pitch><x:octave>7<\/x:octave><x:step>D<\/x:step><\/x:pitch>/);
  assert.match(output, /<!--keep-->/);
  assert.ok(output.indexOf('<lyric number="2">') < output.indexOf('<lyric number="1">'));
});

test('retains a safe original prolog and handles prefixed MusicXML without loading a DTD', () => {
  const prefix = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!--header-->\n<!DOCTYPE score-partwise SYSTEM "https://example.invalid/musicxml.dtd">\n';
  const original = prefix + source();
  const output = createCompatibleMusicXML(original);
  assert.ok(output.startsWith(prefix));
  const prefixed = source().replace(/<(\/?)([\w-]+)(?=[\s/>])/g, '<$1m:$2').replace('<m:score-partwise ', '<m:score-partwise xmlns:m="http://www.musicxml.org/ns/musicxml" ');
  const compatible = createCompatibleMusicXML(prefixed);
  assert.match(compatible, /<m:pitch><m:step>F<\/m:step><m:alter>1<\/m:alter><m:octave>4<\/m:octave><\/m:pitch>/);
});

test('rejects malformed, oversized and entity-bearing XML before normalization', () => {
  assert.throws(() => createCompatibleMusicXML('<score-partwise>'));
  assert.throws(() => createCompatibleMusicXML('<!DOCTYPE score-partwise [<!ENTITY secret SYSTEM "file:///private">]>' + source()));
  assert.throws(() => createCompatibleMusicXML(source() + 'x'.repeat(2 * 1024 * 1024)), /2MB|크기/);
});

test('declares UTF-8 in compatible copies while preserving version, standalone and declarations without encoding', () => {
  for (const encoding of ['UTF-16', 'ISO-8859-1']) {
    const original = `<?xml version="1.0" encoding="${encoding}" standalone="yes"?>` + source();
    const output = createCompatibleMusicXML(original);
    assert.ok(output.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'));
    assert.ok(original.includes(`encoding="${encoding}"`));
    assert.deepEqual(analyzeMusicXML(output).parts[0].measures[0].events, analyzeMusicXML(original).parts[0].measures[0].events);
  }
  const prefix = "<?xml version='1.0' standalone='no'?>";
  assert.ok(createCompatibleMusicXML(prefix + source()).startsWith(prefix));
  const utf8 = '<?xml version="1.0" encoding="utf-8"?>';
  assert.ok(createCompatibleMusicXML(utf8 + source()).startsWith(utf8));
  assert.ok(createCompatibleMusicXML(source()).startsWith('<score-partwise'));
});
