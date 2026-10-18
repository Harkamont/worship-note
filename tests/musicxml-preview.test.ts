import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMusicXMLPreviewSafe } from '../lib/musicxml-preview.ts';
import { analyzeMusicXML } from '../lib/musicxml-review.ts';
import { exportMusicXML } from '../lib/music.ts';
import { createSampleScore } from '../lib/sample.ts';

const attributes = '<attributes><divisions>4</divisions><staves>2</staves><key><fifths>-2</fifths></key><time><beats>3+2</beats><beat-type>8</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef><staff-details number="2"><staff-lines>5</staff-lines></staff-details></attributes>';
const note = '<note><pitch><step>C</step><alter>0.5</alter><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>';
const wrap = (content: string) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1">${content}</measure></part></score-partwise>`;

test('ordinary exported and multi-staff MusicXML can be previewed without altering the XML', () => {
  assert.doesNotThrow(() => assertMusicXMLPreviewSafe(exportMusicXML(createSampleScore())));
  assert.doesNotThrow(() => assertMusicXMLPreviewSafe('\uFEFF' + exportMusicXML(createSampleScore())));
  assert.doesNotThrow(() => assertMusicXMLPreviewSafe(wrap(attributes + note)));
});

test('oversized numeric rendering instructions are rejected before importing or calling OSMD', () => {
  const unsafe = [
    attributes.replace('<staves>2</staves>', '<staves>4294967296</staves>') + note,
    attributes.replace('<staff-lines>5</staff-lines>', '<staff-lines>4294967296</staff-lines>') + note,
    attributes + note.replace('<octave>4</octave>', '<octave>4294967296</octave>'),
    attributes + note.replace('<staff>1</staff>', '<staff>4294967296</staff>'),
    attributes + note.replace('<voice>1</voice>', '<voice>4294967296</voice>'),
    attributes.replace('<divisions>4</divisions>', '<divisions>0</divisions>') + note,
    attributes.replace('<fifths>-2</fifths>', '<fifths>1000000000</fifths>') + note,
    attributes.replace('<beats>3+2</beats>', '<beats>1000000000</beats>') + note,
    attributes.replace('<beat-type>8</beat-type>', '<beat-type>0</beat-type>') + note,
    attributes + note.replace('<duration>4</duration>', '<duration>1000000000</duration>'),
    attributes + note.replace('<type>quarter</type>', '<type>quarter</type><time-modification><actual-notes>1000000000</actual-notes><normal-notes>2</normal-notes></time-modification>'),
    attributes + '<direction><direction-type><octave-shift type="down" size="1000000000"/></direction-type></direction>' + note,
    attributes + '<print><system-layout><system-distance>1000000000</system-distance></system-layout></print>' + note,
    attributes + '<print><page-layout><page-height>1000000000</page-height><page-width>1000</page-width></page-layout></print>' + note,
  ];
  for (const content of unsafe) assert.throws(() => assertMusicXMLPreviewSafe(wrap(content)), /미리보기/);
});

test('nonfinite values, huge sparse indexes and repeated dot expansion are bounded', () => {
  for (const content of [
    attributes.replace('<staves>2</staves>', '<staves>1e309</staves>') + note,
    attributes.replace('number="2"', 'number="4294967296"') + note,
    attributes + note.replace('<type>quarter</type>', '<type>quarter</type>' + '<dot/>'.repeat(9)),
    attributes + note.replace('<duration>4</duration>', '<duration>NaN</duration>'),
  ]) assert.throws(() => assertMusicXMLPreviewSafe(wrap(content)), /미리보기/);
});

test('rendering work is bounded by part, staff, voice, measure and note counts', () => {
  const manyParts = `<score-partwise><part-list>${Array.from({ length: 17 }, (_, i) => `<score-part id="P${i}"><part-name>P</part-name></score-part>`).join('')}</part-list>${Array.from({ length: 17 }, (_, i) => `<part id="P${i}"><measure number="1">${note}</measure></part>`).join('')}</score-partwise>`;
  const manyMeasures = `<score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">${'<measure number="1"/>'.repeat(513)}</part></score-partwise>`;
  const manyVoices = wrap(attributes + Array.from({ length: 17 }, (_, i) => note.replace('<voice>1</voice>', `<voice>${i + 1}</voice>`)).join(''));
  const manyNotes = wrap(attributes + note.repeat(10_001));
  for (const xml of [manyParts, manyMeasures, manyVoices, manyNotes]) assert.throws(() => assertMusicXMLPreviewSafe(xml), /미리보기/);
});

test('preview refusal leaves the original review and downloadable XML available', () => {
  const xml = wrap(attributes.replace('<staves>2</staves>', '<staves>4294967296</staves>') + note);
  const review = analyzeMusicXML(xml);
  assert.throws(() => assertMusicXMLPreviewSafe(review.xml), /미리보기/);
  assert.equal(review.xml, xml); assert.equal(review.partCount, 1); assert.equal(review.noteCount, 1);
});
