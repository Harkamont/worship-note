import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMusicXML } from '../lib/musicxml-review.ts';

const attributes = (beats = 4, divisions = 4) => `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>${beats}</beats><beat-type>4</beat-type></time></attributes>`;
const note = (duration = 16, extra = '', voice = '1', staff = '1', type = 'whole') => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type><staff>${staff}</staff>${extra}</note>`;
const part = (body: string, id = 'P1') => `<part id="${id}">${body}</part>`;
const measure = (body: string, number = '1', attrs = '') => `<measure number="${number}" ${attrs}>${body}</measure>`;
const xml = (parts = part(measure(attributes() + note()))) => `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>내 악보 &amp; 노래</work-title></work><part-list><score-part id="P1"><part-name>선율</part-name></score-part><score-part id="P2"><part-name>반주</part-name></score-part></part-list>${parts}</score-partwise>`;
const codes = (value: ReturnType<typeof analyzeMusicXML>) => value.issues.map(issue => issue.code);

test('preserves original XML and distinguishes score measure count from part measure total', () => {
  const source = xml(part(measure(attributes() + note()) + measure(note(), '2')) + part(measure(attributes() + note()) + measure(note(), '2'), 'P2'));
  const result = analyzeMusicXML(source);
  assert.equal(result.xml, source);
  assert.equal(result.version, 1);
  assert.equal(result.title, '내 악보 & 노래');
  assert.equal(result.partCount, 2);
  assert.equal(result.measureCount, 2);
  assert.equal(result.totalPartMeasures, 4);
  assert.equal(result.noteCount, 4);
  assert.equal(result.parts[1].name, '반주');
  assert.equal(result.parts[0].measures[0].events[0].pitchMidi, 60);
  assert.ok(!result.issues.some(issue => issue.severity === 'error'));
});

test('uses backup and chord semantics instead of adding simultaneous voices together', () => {
  const source = xml(part(measure(attributes() + '<attributes><staves>2</staves></attributes>' + note() + note(16, '<chord/>').replace('<step>C</step>', '<step>E</step>') + '<backup><duration>16</duration></backup>' + note(16, '', '2', '2'))));
  const result = analyzeMusicXML(source);
  const bar = result.parts[0].measures[0];
  assert.equal(bar.durationQuarterBeats, 4);
  assert.deepEqual(bar.events.map(event => event.onsetQuarterBeats), [0, 0, 0]);
  assert.equal(bar.events[1].chord, true);
  assert.equal(result.parts[0].staffCount, 2);
  assert.deepEqual(result.parts[0].voiceIds, ['1', '2']);
  assert.ok(!codes(result).includes('MEASURE_OVERFULL'));
  assert.equal(result.xml, source);
});

test('accounts for explicit forward time without inventing a rest event', () => {
  const result = analyzeMusicXML(xml(part(measure(attributes() + note(8, '', '1', '1', 'half') + '<forward><duration>4</duration><voice>1</voice></forward>' + note(4, '', '1', '1', 'quarter')))));
  const bar = result.parts[0].measures[0];
  assert.equal(bar.durationQuarterBeats, 4);
  assert.deepEqual(bar.events.map(event => event.onsetQuarterBeats), [0, 3]);
  assert.equal(bar.events.length, 2);
  assert.ok(!codes(result).includes('MEASURE_UNDERFULL'));
});

test('reports short and overfull measures without altering the original music', () => {
  const source = xml(part(measure(attributes() + note(8, '', '1', '1', 'half')) + measure(note() + note(4, '', '1', '1', 'quarter'), '2')));
  const result = analyzeMusicXML(source);
  assert.ok(codes(result).includes('MEASURE_UNDERFULL'));
  assert.ok(codes(result).includes('MEASURE_OVERFULL'));
  assert.equal(result.noteCount, 3);
  assert.equal(result.xml, source);
  assert.equal(result.parts[0].measures[0].events.length, 1);
});

test('accepts explicit implicit pickup length without treating it as a missing-rest error', () => {
  const source = xml(part(measure(attributes() + note(4, '', '1', '1', 'quarter'), '0', 'implicit="yes"') + measure(note(), '1')));
  const result = analyzeMusicXML(source);
  assert.ok(!codes(result).includes('MEASURE_UNDERFULL'));
  assert.ok(codes(result).includes('IMPLICIT_MEASURE'));
  assert.equal(result.parts[0].measures[0].implicit, true);
  assert.equal(result.parts[0].measures[0].durationQuarterBeats, 1);
  assert.equal(result.xml, source);
});

test('validates real tuplet durations and preserves tuplet events', () => {
  const tuplet = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes><normal-type>quarter</normal-type></time-modification>';
  const body = attributes(2, 6) + [0, 1, 2].map(() => note(4, tuplet, '1', '1', 'quarter')).join('');
  const result = analyzeMusicXML(xml(part(measure(body))));
  assert.deepEqual(result.parts[0].measures[0].events.map(event => event.durationQuarterBeats), [2 / 3, 2 / 3, 2 / 3]);
  assert.equal(result.parts[0].measures[0].durationQuarterBeats, 2);
  assert.ok(!codes(result).includes('NOTATED_DURATION_MISMATCH'));
  const invalid = analyzeMusicXML(xml(part(measure(body.replaceAll('<duration>4</duration>', '<duration>6</duration>')))));
  assert.ok(codes(invalid).includes('NOTATED_DURATION_MISMATCH'));
  assert.ok(codes(invalid).includes('MEASURE_OVERFULL'));
});

test('records changes of key and time rather than rejecting or flattening them', () => {
  const second = attributes(3).replace('<fifths>0</fifths>', '<fifths>2</fifths>');
  const source = xml(part(measure(attributes() + note()) + measure(second + note(12, '<dot/>', '1', '1', 'half'), '2')));
  const result = analyzeMusicXML(source);
  assert.ok(codes(result).includes('KEY_CHANGE'));
  assert.ok(codes(result).includes('TIME_CHANGE'));
  assert.equal(result.parts[0].measures[1].expectedQuarterBeats, 3);
  assert.ok(!result.issues.some(issue => issue.severity === 'error'));
  assert.equal(result.xml, source);
});

test('keeps lyric verses and voices separate, including duplicated vocal lines', () => {
  const lyrics = '<lyric number="1" name="1절"><text>같은</text><elision> </elision><text>가사</text></lyric><lyric number="2"><text>다른절</text></lyric>';
  const result = analyzeMusicXML(xml(part(measure(attributes() + note(16, lyrics) + '<backup><duration>16</duration></backup>' + note(16, lyrics, '2')))));
  assert.equal(result.lyricVerses.length, 4);
  assert.deepEqual(new Set(result.lyricVerses.map(verse => verse.voice)), new Set(['1', '2']));
  assert.equal(result.parts[0].measures[0].events[0].lyrics[0].text, '같은 가사');
  assert.equal(result.lyricsText.match(/같은 가사/g)?.length, 2);
  assert.equal(result.lyricsText.match(/다른절/g)?.length, 2);
  assert.match(result.lyricsText, /성부 1/);
  assert.match(result.lyricsText, /성부 2/);
});

test('exports sounding durations, written pitches and tie starts/stops for independent comparison', () => {
  const source = xml(part(measure(attributes() + note(16, '<tie type="start"/>').replace('<step>C</step>', '<step>F</step><alter>1</alter>')) + measure(note(16, '<notations><tied type="stop"/></notations>'), '2')));
  const result = analyzeMusicXML(source);
  assert.equal(result.parts[0].measures[0].events[0].pitchMidi, 66);
  assert.equal(result.parts[0].measures[0].events[0].tieStart, true);
  assert.equal(result.parts[0].measures[1].events[0].tieStop, true);
});

test('retains harmony root, kind, bass and offset relative to the current cursor', () => {
  const harmony = '<harmony><root><root-step>F</root-step><root-alter>1</root-alter></root><kind text="m7">minor-seventh</kind><bass><bass-step>C</bass-step><bass-alter>1</bass-alter></bass><offset>2</offset></harmony>';
  const result = analyzeMusicXML(xml(part(measure(attributes() + note(8, '', '1', '1', 'half') + harmony + note(8, '', '1', '1', 'half')))));
  assert.equal(result.chordCount, 1);
  assert.deepEqual(result.parts[0].measures[0].chords[0].root, { step: 'F', alter: 1 });
  assert.deepEqual(result.parts[0].measures[0].chords[0].bass, { step: 'C', alter: 1 });
  assert.equal(result.parts[0].measures[0].chords[0].kind, 'minor-seventh');
  assert.equal(result.parts[0].measures[0].chords[0].kindText, 'm7');
  assert.equal(result.parts[0].measures[0].chords[0].offsetQuarterBeats, 0.5);
  assert.equal(result.parts[0].measures[0].chords[0].onsetQuarterBeats, 2.5);
});

test('grace notes do not require duration and do not advance time', () => {
  const grace = '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>';
  const result = analyzeMusicXML(xml(part(measure(attributes() + grace + note()))));
  assert.equal(result.parts[0].measures[0].events[0].durationQuarterBeats, 0);
  assert.equal(result.parts[0].measures[0].events[0].grace, true);
  assert.equal(result.parts[0].measures[0].events[1].onsetQuarterBeats, 0);
  assert.ok(!codes(result).includes('INVALID_DURATION'));
});

test('reports invalid duration, backup before start, missing chord base and voice overlaps', () => {
  assert.ok(codes(analyzeMusicXML(xml(part(measure(attributes() + note(0)))))).includes('INVALID_DURATION'));
  assert.ok(codes(analyzeMusicXML(xml(part(measure(attributes() + '<backup><duration>4</duration></backup>' + note()))))).includes('BACKUP_BEFORE_MEASURE'));
  assert.ok(codes(analyzeMusicXML(xml(part(measure(attributes() + note(16, '<chord/>')))))).includes('CHORD_WITHOUT_BASE'));
  assert.ok(codes(analyzeMusicXML(xml(part(measure(attributes() + note() + '<backup><duration>16</duration></backup>' + note()))))).includes('VOICE_OVERLAP'));
});

test('preserves nonmetric and staff-specific time data without claiming a single meter check', () => {
  const withoutMeter = analyzeMusicXML(xml(part(measure(attributes().replace('<time><beats>4</beats><beat-type>4</beat-type></time>', '<time><senza-misura/></time>') + note()))));
  assert.equal(withoutMeter.parts[0].measures[0].expectedQuarterBeats, null);
  assert.ok(codes(withoutMeter).includes('NON_METRIC_MEASURE'));
  const multi = '<attributes><divisions>4</divisions><staves>2</staves><time number="1"><beats>3</beats><beat-type>4</beat-type></time><time number="2"><beats>2</beats><beat-type>4</beat-type></time></attributes>';
  const result = analyzeMusicXML(xml(part(measure(multi + note(12, '<dot/>', '1', '1', 'half') + '<backup><duration>12</duration></backup>' + note(8, '', '2', '2', 'half')))));
  assert.equal(result.parts[0].measures[0].expectedQuarterBeats, null);
  assert.ok(codes(result).includes('MULTIMETRIC_MEASURE'));
});

test('strips only safe external DTD for analysis while preserving the original source', () => {
  const source = xml().replace('<score-partwise', '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "https://www.musicxml.org/dtds/partwise.dtd"><score-partwise');
  const result = analyzeMusicXML(source);
  assert.equal(result.xml, source);
  assert.equal(result.title, '내 악보 & 노래');
  const cdata = xml().replace('내 악보 &amp; 노래', '<![CDATA[<가&나>]]>');
  assert.equal(analyzeMusicXML(cdata).title, '<가&나>');
});

test('rejects internal DTD, external entities, unknown entities, invalid character references and malformed XML', () => {
  const malicious = [xml().replace('<score-partwise', '<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "file:///private.txt">]><score-partwise'),
    xml().replace('내 악보', '&unknown;'), xml().replace('내 악보', '&#0;'), xml().replace('</note>', '</other>')];
  for (const source of malicious) assert.throws(() => analyzeMusicXML(source), /XML|DTD|엔터티|문자/);
});

test('enforces UTF-8 size, nesting depth and node count before parsing', () => {
  assert.throws(() => analyzeMusicXML(xml().replace('내 악보', '가'.repeat(800_000))), /2MB/);
  assert.throws(() => analyzeMusicXML('<score-partwise>' + '<x>'.repeat(70) + '</x>'.repeat(70) + '</score-partwise>'), /깊|복잡|구조/);
  assert.throws(() => analyzeMusicXML('<score-partwise>' + '<x/>'.repeat(100_001) + '</score-partwise>'), /복잡|항목|구조/);
  assert.throws(() => analyzeMusicXML('<score-timewise/>'), /score-partwise/);
});

test('does not allocate arrays proportional to a declared staff count', () => {
  const source = xml(part(measure(attributes() + '<attributes><staves>4294967296</staves></attributes>' + note())));
  const result = analyzeMusicXML(source);
  assert.equal(result.xml, source);
  assert.equal(result.parts[0].staffCount, 4_294_967_296);
  assert.equal(result.parts[0].measures[0].expectedQuarterBeats, 4);
});

test('a full-measure rest uses the measure length rather than the whole-note symbol length', () => {
  const rest = '<note><rest measure="yes"/><duration>12</duration><type>whole</type></note>';
  const result = analyzeMusicXML(xml(part(measure(attributes(3) + rest))));
  assert.equal(result.parts[0].measures[0].durationQuarterBeats, 3);
  assert.ok(!codes(result).includes('NOTATED_DURATION_MISMATCH'));
});

test('checks invalid tuplet ratios even when the optional written type is absent', () => {
  const bad = '<time-modification><actual-notes>0</actual-notes><normal-notes>2</normal-notes></time-modification>';
  const source = xml(part(measure(attributes() + note(16, bad).replace('<type>whole</type>', ''))));
  assert.ok(codes(analyzeMusicXML(source)).includes('INVALID_TUPLET_RATIO'));
});

test('requires any external DOCTYPE declaration to be in the XML prolog', () => {
  const source = xml().replace('<work>', '<!DOCTYPE score-partwise SYSTEM "https://example.com/partwise.dtd"><work>');
  assert.throws(() => analyzeMusicXML(source), /XML|DTD/);
});

test('marks a nonfinite accumulated timeline as unknown instead of returning Infinity', () => {
  const huge = '1' + '0'.repeat(308);
  const enormousNote = note().replace('<duration>16</duration>', `<duration>${huge}</duration>`);
  const result = analyzeMusicXML(xml(part(measure(attributes(4, 1) + enormousNote + enormousNote))));
  assert.equal(result.parts[0].measures[0].durationQuarterBeats, null);
  assert.ok(codes(result).includes('INVALID_TIMELINE'));
});

test('TXT joins syllabic words and omits engraving-only extensions without mixing streams', () => {
  const lyric = (text: string, syllabic: string, extra = '') => `<lyric number="1"><syllabic>${syllabic}</syllabic><text>${text}</text>${extra}</lyric>`;
  const source = xml(part(measure(attributes() + note(4, lyric('하', 'begin'), '1', '1', 'quarter') + note(4, lyric('나', 'middle'), '1', '1', 'quarter') + note(4, lyric('님', 'end', '<end-line/>'), '1', '1', 'quarter') + note(4, lyric('_', 'single', '<extend/>'), '1', '1', 'quarter'))));
  const result = analyzeMusicXML(source);
  assert.equal(result.lyricsText.split('\n').slice(1).join('\n'), '하나님');
  assert.equal(result.parts[0].measures[0].events[2].lyrics[0].endLine, true);
  assert.equal(result.parts[0].measures[0].events[3].lyrics[0].text, '_');
});

test('TXT concatenates unmarked syllables per measure and removes standalone engraving marks', () => {
  const lyric = (text: string) => `<lyric number="1"><text>${text}</text></lyric>`;
  const source = xml(part(measure(attributes() + note(4, lyric('하'), '1', '1', 'quarter') + note(4, lyric('나'), '1', '1', 'quarter') + note(4, lyric('님'), '1', '1', 'quarter') + note(4, lyric('—'), '1', '1', 'quarter'))));
  assert.equal(analyzeMusicXML(source).lyricsText.split('\n').slice(1).join('\n'), '하나님');
});

test('a verse name present on only one note does not split a numbered verse stream', () => {
  const first = '<lyric number="1" name="1절"><syllabic>begin</syllabic><text>하</text></lyric>';
  const last = '<lyric number="1"><syllabic>end</syllabic><text>나님</text></lyric>';
  const source = xml(part(measure(attributes() + note(8, first, '1', '1', 'half') + note(8, last, '1', '1', 'half'))));
  const result = analyzeMusicXML(source);
  assert.equal(result.lyricVerses.length, 1);
  assert.match(result.lyricsText, /1절\]\n하나님$/);
});
