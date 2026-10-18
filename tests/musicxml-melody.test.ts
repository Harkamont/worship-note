import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMusicXML } from '../lib/musicxml-review.ts';
import { readFileSync } from 'node:fs';
import { assertMusicXMLPreviewSafe } from '../lib/musicxml-preview.ts';

const feature = await import('../lib/musicxml-melody.ts').catch(() => null);
const attr = (extra = '') => `<attributes><divisions>12</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>${extra}</attributes>`;
const note = (pitch: string | null, duration = 12, extra = '', voice = '1', staff = '1', type = 'quarter') => `<note>${pitch ? `<pitch><step>${pitch[0]}</step><octave>${pitch.slice(1)}</octave></pitch>` : '<rest/>'}<duration>${duration}</duration><voice>${voice}</voice><type>${type}</type><staff>${staff}</staff>${extra}</note>`;
const measure = (body: string, number = '1', attrs = '') => `<measure number="${number}" ${attrs}>${body}</measure>`;
const part = (body: string, id = 'P1') => `<part id="${id}">${body}</part>`;
const score = (body: string, names = [['P1', 'Piano']]) => `<?xml version="1.0"?><score-partwise version="4.0"><part-list>${names.map(([id, name]) => `<score-part id="${id}"><part-name>${name}</part-name></score-part>`).join('')}</part-list>${body}</score-partwise>`;
const selected = { partId: 'P1', staff: '1', voice: '1' };
function extract(xml: string, selection = selected) { assert.ok(feature, 'Local SATB-to-melody extraction API must exist'); return feature.extractMusicXMLMelody(xml, selection); }
function list(xml: string) { assert.ok(feature, 'Local SATB-to-melody source selection API must exist'); return feature.listMusicXMLMelodySources(xml); }
const events = (xml: string) => analyzeMusicXML(xml).parts[0].measures.flatMap(m => m.events);

test('provides the missing local SATB-to-melody feature', () => {
  assert.equal(typeof feature?.extractMusicXMLMelody, 'function', 'SATB extraction must be implemented locally');
});

test('prefers an explicitly named soprano part over a higher accompaniment and removes other SATB parts', () => {
  const source = score(part(measure(attr() + note('C6', 48, '', '1', '1', 'whole')), 'P1') + part(measure(attr() + note('G4', 48, '', 'S', '1', 'whole')), 'P2') + part(measure(attr() + note('E4', 48, '', 'A', '1', 'whole')), 'P3'), [['P1', 'Piano'], ['P2', 'Soprano'], ['P3', 'Alto']]);
  const sources = list(source);
  assert.deepEqual([sources[0].partId, sources[0].staff, sources[0].voice], ['P2', '1', 'S']);
  const result = extract(source, { partId: 'P2', staff: '1', voice: 'S' });
  const review = analyzeMusicXML(result.xml);
  assert.equal(review.partCount, 1);
  assert.equal(review.parts[0].staffCount, 1);
  assert.deepEqual(review.parts[0].voiceIds, ['1']);
  assert.equal(review.parts[0].measures[0].events[0].pitchMidi, 67);
  assert.equal(result.sourceNoteCount, 3);
  assert.equal(result.melodyNoteCount, 1);
  assert.deepEqual(result.selection, { partId: 'P2', staff: '1', voice: 'S' });
  assert.equal(analyzeMusicXML(source).partCount, 3);
});

test('defaults to first part/top staff, prefers pitched measure coverage before median pitch, and includes rest-only measures', () => {
  const body = measure(attr('<staves>2</staves><clef number="2"><sign>F</sign><line>4</line></clef>') + note('C5', 48, '', '2', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('G4', 48, '', '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('C6', 48, '', '3', '2', 'whole')) + measure(note(null, 48, '', '2', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('G4', 48, '', '1', '1', 'whole'), '2');
  const sources = list(score(part(body))).filter(source => source.voice !== '*');
  assert.equal(sources[0].voice, '1');
  assert.equal(sources[0].staff, '1');
  assert.equal(sources[0].measureCoverage, 2);
  const result = extract(score(part(body)), { partId: 'P1', staff: '2', voice: '3' });
  assert.equal(analyzeMusicXML(result.xml).parts[0].staffCount, 1);
  assert.match(result.xml, /<clef number="1"><sign>F<\/sign>/);
  assert.ok(!result.xml.includes('<clef number="2"'));
});

test('takes the highest note in each selected anchor chord group and copies missing numbered lyrics and rhythm engraving', () => {
  const lyrics = '<lyric number="1"><text>하</text></lyric><lyric number="2"><text>둘</text></lyric>';
  const anchor = note('C4', 18, '<dot/>' + lyrics, '1', '1', 'quarter');
  const top = note('G4', 18, '<chord/><lyric number="2"><text>별도</text></lyric>').replace('<type>quarter</type>', '');
  const result = extract(score(part(measure(attr() + anchor + top + note('D4', 30, '', '1', '1', 'half')))));
  const out = events(result.xml);
  assert.deepEqual(out.map(n => [n.pitchMidi, n.onsetQuarterBeats, n.durationQuarterBeats]), [[67, 0, 1.5], [62, 1.5, 2.5]]);
  assert.deepEqual(out[0].lyrics.map(l => [l.number, l.text]), [['2', '별도'], ['1', '하']]);
  assert.ok(result.warnings.some(warning => /같은 화음.*2.*가사.*다르/.test(warning)));
  assert.match(result.xml, /<type>quarter<\/type><dot\/>/);
  assert.ok(out.every(n => !n.chord));
});

test('preserves lyrics on every selected chord tone within its own anchor group, including a middle tone', () => {
  const anchor = note('C4', 24, '<lyric number="1"><text>하</text></lyric>', '1', '1', 'half');
  const middle = note('E4', 24, '<chord/><lyric number="2"><text>첫</text></lyric>', '1', '1', 'half');
  const top = note('G4', 24, '<chord/>', '1', '1', 'half');
  const next = note('A4', 24, '<lyric number="1"><text>나</text></lyric><lyric number="2"><text>둘</text></lyric>', '1', '1', 'half');
  const result = extract(score(part(measure(attr() + anchor + middle + top + next))));
  assert.deepEqual(events(result.xml).map(event => [event.pitchMidi, event.lyrics.map(lyric => [lyric.number, lyric.text])]), [[67, [['1', '하'], ['2', '첫']]], [69, [['1', '나'], ['2', '둘']]]]);
});

test('never fills held soprano or soprano rests with asynchronous alto notes', () => {
  const source = score(part(measure(attr() + note('C5', 36, '', '1', '1', 'half').replace('<type>half</type>', '<type>half</type><dot/>') + note(null, 12) + '<backup><duration>48</duration></backup>' + note('E4', 12, '', '2') + note('F4', 12, '', '2') + note('D5', 12, '', '2') + note('G4', 12, '', '2'))));
  const result = extract(source);
  assert.deepEqual(events(result.xml).map(n => [n.pitchMidi, n.rest, n.onsetQuarterBeats, n.durationQuarterBeats]), [[72, false, 0, 3], [null, true, 3, 1]]);
});

test('preserves a shorter highest chord tone without inventing its duration', () => {
  const source = score(part(measure(attr() + note('C4', 24, '', '1', '1', 'half') + note('G4', 12, '<chord/>') + note('A4', 24, '', '1', '1', 'half'))));
  const out = events(extract(source).xml);
  assert.deepEqual(out.map(n => [n.pitchMidi, n.onsetQuarterBeats, n.durationQuarterBeats]), [[67, 0, 1], [69, 2, 2]]);
});

test('preserves pickup, all verses, selected ties, tuplets, key/meter changes, repeats and harmony offsets', () => {
  const lyric = '<lyric number="1"><text>주</text></lyric><lyric number="2"><text>참</text><extend type="start"/></lyric>';
  const harmony = '<harmony><root><root-step>F</root-step></root><kind text="maj7">major-seventh</kind><offset>6</offset><staff>2</staff></harmony>';
  const pickup = measure(attr() + '<barline location="left"><repeat direction="forward"/></barline>' + note('G4', 12, '<tie type="start"/><notations><tied type="start" number="2"/></notations>' + lyric), '0', 'implicit="yes"');
  const tuple = note('A4', 4, '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><notations><tuplet type="start" number="2"/></notations>', '1', '1', 'eighth');
  const changed = measure('<attributes><key><fifths>2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' + note('G4', 12, '<tie type="stop"/><notations><tied type="stop" number="2"/></notations>') + tuple + tuple + tuple + note(null, 12) + '<backup><duration>36</duration></backup>' + note('C3', 12, '', '2', '2') + harmony + note('D3', 24, '', '2', '2', 'half') + '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>', '1');
  const source = score(part(pickup + changed));
  const result = extract(source);
  const review = analyzeMusicXML(result.xml);
  assert.equal(review.parts[0].measures[0].implicit, true);
  assert.equal(review.parts[0].measures[0].events[0].tieStart, true);
  assert.equal(review.parts[0].measures[1].events[0].tieStop, true);
  assert.deepEqual(review.lyricVerses.map(v => v.number), ['1', '2']);
  assert.equal(review.parts[0].measures[1].chords[0].onsetQuarterBeats, 1.5);
  assert.equal(review.parts[0].measures[1].chords[0].offsetQuarterBeats, 0.5);
  assert.ok(review.parts[0].measures[1].changes.some(c => c.type === 'key' && c.value.includes('fifths=2')));
  assert.equal(review.parts[0].measures[1].expectedQuarterBeats, 3);
  assert.equal(review.parts[0].measures[1].events[1].durationQuarterBeats, 1 / 3);
  assert.match(result.xml, /<time-modification>/);
  assert.match(result.xml, /<tied type="stop" number="2"\/>/);
  assert.match(result.xml, /<repeat direction="backward"\/>/);
});

test('keeps grace and principal note separate even at the same onset, and retains directions inside held notes', () => {
  const grace = '<note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff></note>';
  const direction = '<direction placement="above"><direction-type><words>천천히</words></direction-type><offset>6</offset></direction>';
  const source = score(part(measure(attr() + grace + note('C5', 48, '', '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('E4', 12, '', '2') + direction + note('F4', 36, '<dot/>', '2', '1', 'half'))));
  const result = extract(source);
  assert.deepEqual(events(result.xml).map(n => [n.pitchMidi, n.grace, n.onsetQuarterBeats]), [[74, true, 0], [72, false, 0]]);
  assert.match(result.xml, /<words>천천히<\/words>/);
  assert.match(result.xml, /<offset>6<\/offset><\/direction>/);
});

test('omits directions explicitly scoped to another staff or voice while retaining global and selected directions', () => {
  const lowerStart = '<direction><direction-type><octave-shift type="down" size="8"/></direction-type><staff>2</staff></direction>';
  const lowerStop = '<direction><direction-type><octave-shift type="stop" size="8"/></direction-type><staff>2</staff></direction>';
  const altoDirection = '<direction><direction-type><words>알토만</words></direction-type><voice>2</voice><staff>1</staff></direction>';
  const sopranoDirection = '<direction><direction-type><words>선율만</words></direction-type><voice>1</voice><staff>1</staff></direction>';
  const global = '<direction><direction-type><words>모두 천천히</words></direction-type></direction>';
  const source = score(part(measure(attr('<staves>2</staves>') + lowerStart + altoDirection + sopranoDirection + global + note('C5', 48, '', '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('C3', 48, '', '2', '2', 'whole') + lowerStop)));
  const result = extract(source);
  assert.ok(!result.xml.includes('<octave-shift'));
  assert.ok(!result.xml.includes('알토만'));
  assert.match(result.xml, /선율만/);
  assert.match(result.xml, /모두 천천히/);
  assert.deepEqual(events(result.xml).map(event => [event.pitchMidi, event.durationQuarterBeats]), [[72, 4]]);
});

test('refuses wholly lost numbered lyric verses on an omitted stream without copying them to unrelated notes', () => {
  const verses = '<lyric number="1"><text>하나</text></lyric><lyric number="2"><text>둘</text></lyric><lyric number="3"><text>셋</text></lyric>';
  const source = score(part(measure(attr() + note('C5', 48, '', '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('E4', 48, verses, '2', '1', 'whole'))));
  assert.throws(() => extract(source), /가사.*1.*2.*3.*성부 2|성부 2.*가사.*1.*2.*3/);
  const someVerses = source.replace('<voice>1</voice>', '<lyric number="1"><text>선율</text></lyric><voice>1</voice>');
  assert.throws(() => extract(someVerses), /가사.*2.*3|2.*3.*가사/);
});

test('warns with the omitted lyric stream and verse when its verse remains on the selected melody', () => {
  const source = score(part(measure(attr() + note('C5', 48, '<lyric number="1"><text>선율</text></lyric>', '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('E4', 48, '<lyric number="1"><text>알토</text></lyric>', '2', '1', 'whole'))));
  const result = extract(source);
  assert.deepEqual(events(result.xml)[0].lyrics.map(lyric => lyric.text), ['선율']);
  assert.ok(result.warnings.some(warning => /P1.*보표 1.*성부 2.*1.*가사/.test(warning)));
});

test('quantizes cursor movement after triplets to integer divisions so a safe input remains previewable', () => {
  const triplet = note('E4', 1, '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>', '2', '1', 'eighth');
  const direction = '<direction><direction-type><words>일곱 음 뒤</words></direction-type></direction>';
  const body = attr().replace('<divisions>12</divisions>', '<divisions>3</divisions>') + note('C5', 12, '', '1', '1', 'whole') + '<backup><duration>12</duration></backup>' + triplet.repeat(7) + direction + triplet.repeat(5);
  const source = score(part(measure(body)));
  assert.doesNotThrow(() => assertMusicXMLPreviewSafe(source));
  const result = extract(source);
  assert.doesNotThrow(() => assertMusicXMLPreviewSafe(result.xml));
  assert.match(result.xml, /<backup><duration>5<\/duration><\/backup>/);
  assert.match(result.xml, /<forward><duration>5<\/duration><\/forward>/);
  assert.deepEqual(events(result.xml).map(event => [event.pitchMidi, event.onsetQuarterBeats, event.durationQuarterBeats]), [[72, 0, 4]]);
});

test('rejects a required cursor movement that cannot be represented in integer source divisions', () => {
  const direction = '<direction><direction-type><words>분수 위치</words></direction-type></direction>';
  const source = score(part(measure(attr().replace('<divisions>12</divisions>', '<divisions>3</divisions>') + note('C5', 12, '', '1', '1', 'whole') + '<backup><duration>12</duration></backup>' + note('E4', 0.5, '', '2', '1', 'eighth') + direction + note('F4', 11.5, '', '2', '1', 'half'))));
  assert.throws(() => extract(source), /정수.*divisions|divisions.*정수|시간.*표현/);
});

test('rejects unsafe input, missing selection, overlapping chosen notes and mid-measure division shifts', () => {
  const base = score(part(measure(attr() + note('C5', 48, '', '1', '1', 'whole'))));
  assert.throws(() => extract(base, { ...selected, voice: 'missing' }), /성부|선택/);
  assert.throws(() => feature!.extractMusicXMLMelody(base, undefined as never), /선택/);
  assert.throws(() => extract(base.replace('<score-partwise', '<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "file:///private">]><score-partwise')), /DTD|엔터티/);
  assert.throws(() => extract('x'.repeat(2 * 1024 * 1024 + 1)), /2MB/);
  const overlap = score(part(measure(attr() + note('C5', 48, '', '1', '1', 'whole') + '<backup><duration>36</duration></backup>' + note('D5'))));
  assert.throws(() => extract(overlap), /겹|중복/);
  const divisions = score(part(measure(attr() + note('C5') + '<attributes><divisions>24</divisions></attributes>' + note('D5', 72, '', '1', '1', 'half'))));
  assert.throws(() => extract(divisions), /divisions|마디 안/);
});

test('warns when an omitted voice is higher than the selected line without switching voices', () => {
  const source = score(part(measure(attr() + note('D4', 48, '', '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('C5', 48, '', '2', '1', 'whole'))));
  const result = extract(source);
  assert.deepEqual(events(result.xml).map(n => n.pitchMidi), [62]);
  assert.ok(result.warnings.some(w => /다른 성부/.test(w)));
});

test('offers an explicit staff melody mode and follows changing voice IDs in chronological order', () => {
  const lyric = (text: string) => `<lyric number="1"><text>${text}</text></lyric>`;
  const first = measure(attr() + note('C5', 48, lyric('하'), '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('E4', 48, '', '2', '1', 'whole'));
  const second = measure(note('E4', 48, '', '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('D5', 48, lyric('나'), '2', '1', 'whole'), '2');
  // The highest attack changes voice inside this measure. Source XML writes
  // voice 1 first, so emitting retained notes in document order would go back.
  const third = measure(note('C4', 12, '', '1') + note('G5', 36, lyric('셋'), '1', '1', 'half') + '<backup><duration>48</duration></backup>' + note('E5', 12, lyric('둘'), '2') + note('G4', 36, '', '2', '1', 'half'), '3');
  const source = score(part(first + second + third));
  const automatic = list(source).find(candidate => candidate.voice === '*');
  assert.ok(automatic, 'A separate staff melody choice must be available');
  assert.equal(automatic.staff, '1');
  assert.equal(automatic.measureCoverage, 3);
  assert.ok(list(source).some(candidate => candidate.voice === '1'));
  const result = extract(source, { ...selected, voice: '*' });
  assert.deepEqual(events(result.xml).map(event => [event.pitchMidi, event.onsetQuarterBeats, event.durationQuarterBeats, event.lyrics[0]?.text]), [[72, 0, 4, '하'], [74, 0, 4, '나'], [76, 0, 1, '둘'], [79, 1, 3, '셋']]);
  assert.ok(!/<backup>|<forward>/.test(result.xml), 'A contiguous extracted melody should remain directly editable');
  assert.equal(result.selection.voice, '*');
  assert.equal(analyzeMusicXML(source).noteCount, 8);
  assert.ok(result.warnings.some(warning => /자동.*선율|선율.*자동/.test(warning)));
});

test('staff melody extraction preserves held notes and explicit melody rests instead of filling them with moving alto', () => {
  const source = score(part(measure(attr() + note('C5', 36, '<dot/>', '1', '1', 'half') + note(null, 12) + '<backup><duration>48</duration></backup>' + note('E4', 12, '', '2') + note('F4', 12, '', '2') + note('D5', 12, '', '2') + note('G4', 12, '', '2'))));
  const result = extract(source, { ...selected, voice: '*' });
  assert.deepEqual(events(result.xml).map(event => [event.pitchMidi, event.rest, event.onsetQuarterBeats, event.durationQuarterBeats]), [[72, false, 0, 3], [null, true, 3, 1]]);
  assert.ok(result.warnings.some(warning => /겹|지속|긴 음/.test(warning)), 'A higher omitted attack under a held melody must be called out');
  assert.ok(result.warnings.some(warning => /1마디.*쉼표.*다른 성부/.test(warning)), 'A retained melody rest must be identified when other voices keep sounding');
});

test('staff melody mode retains ties across changing voice IDs and leaves source gaps explicit', () => {
  const first = measure(attr() + note('C5', 48, '<tie type="start"/>', '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('E4', 48, '', '2', '1', 'whole'));
  const second = measure(note('E4', 48, '', '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + note('C5', 24, '<tie type="stop"/>', '2', '1', 'half') + '<forward><duration>12</duration></forward>' + note('D5', 12, '', '2'), '2');
  const result = extract(score(part(first + second)), { ...selected, voice: '*' });
  assert.deepEqual(events(result.xml).map(event => [event.pitchMidi, event.onsetQuarterBeats, event.durationQuarterBeats, event.tieStart, event.tieStop]), [[72, 0, 4, true, false], [72, 0, 2, false, true], [74, 3, 1, false, false]]);
  assert.match(result.xml, /<forward><duration>12<\/duration><\/forward>/);
  assert.ok(result.warnings.some(warning => /빈 시간|음표가 없는/.test(warning)));
});

test('staff melody mode orders a retained grace note before a principal note written earlier in another voice', () => {
  const grace = '<note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><voice>2</voice><type>eighth</type><staff>1</staff></note>';
  const source = score(part(measure(attr() + note('C5', 48, '', '1', '1', 'whole') + '<backup><duration>48</duration></backup>' + grace + note('E4', 48, '', '2', '1', 'whole'))));
  const result = extract(source, { ...selected, voice: '*' });
  assert.deepEqual(events(result.xml).map(event => [event.pitchMidi, event.grace, event.onsetQuarterBeats]), [[74, true, 0], [72, false, 0]]);
});

test('does not duplicate an existing lyric verse when its name differs, and warns about broken selected ties', () => {
  const source = score(part(measure(attr() + note('C4', 24, '<tie type="start"/><lyric number="1" name="original"><text>낮음</text></lyric>', '1', '1', 'half') + note('G4', 24, '<chord/><tie type="stop"/><lyric number="1" name="top"><text>높음</text></lyric>', '1', '1', 'half') + note('A4', 24, '', '1', '1', 'half'))));
  const result = extract(source);
  assert.deepEqual(events(result.xml)[0].lyrics.map(lyric => lyric.text), ['높음']);
  assert.ok(result.warnings.some(w => /붙임줄/.test(w)));
  assert.equal(events(result.xml)[0].tieStart, false);
  assert.equal(events(result.xml)[0].tieStop, true);
});

test('normalizes staff layouts without retaining a second staff layout or changing tuplet numbers', () => {
  const layout = '<print><staff-layout number="1"><staff-distance>50</staff-distance></staff-layout><staff-layout number="2"><staff-distance>90</staff-distance></staff-layout></print>';
  const source = score(part(measure(attr('<staves>2</staves><clef number="2"><sign>F</sign><line>4</line></clef>') + layout + note('C4', 48, '<notations><tuplet type="start" number="2"/></notations>', '5', '2', 'whole'))));
  const result = extract(source, { ...selected, voice: '5', staff: '2' });
  assert.equal(result.xml.match(/<staff-layout/g)?.length, 1);
  assert.match(result.xml, /<staff-distance>90<\/staff-distance>/);
  assert.match(result.xml, /<tuplet type="start" number="2"\/>/);
});

test('rejects harmony on an omitted part instead of silently dropping printed chord labels', () => {
  const harmony = '<harmony><root><root-step>F</root-step></root><kind>major</kind></harmony>';
  const source = score(part(measure(attr() + note('G4', 48, '', '1', '1', 'whole'))) + part(measure(attr() + harmony + note('C3', 48, '', '1', '1', 'whole')), 'P2'), [['P1', 'Soprano'], ['P2', 'Piano']]);
  assert.throws(() => extract(source), /다른 파트.*코드|코드.*다른 파트/);
});

test('extracts the supplied hymn as a single fixed stream while preserving every printed harmony and source lyric verse', () => {
  const fixture = new URL('../../work/direct-musicxml-benchmark/hybrid-sol/01.musicxml', import.meta.url);
  // The app's deterministic regression suite remains runnable without local benchmark evidence.
  let source: string;
  try { source = readFileSync(fixture, 'utf8'); } catch { return; }
  const before = analyzeMusicXML(source);
  const result = extract(source);
  const after = analyzeMusicXML(result.xml);
  assert.equal(before.noteCount, 297);
  assert.equal(after.noteCount, 78);
  assert.equal(after.chordCount, 35);
  assert.equal(after.partCount, 1);
  assert.equal(after.parts[0].staffCount, 1);
  assert.equal(after.parts[0].measures.length, 21);
  assert.deepEqual(after.lyricVerses.map(verse => verse.number), ['1', '2', '3']);
  assert.deepEqual(after.parts[0].measures[1].events.map(event => event.pitchMidi), [65, 69, 69, 67]);
  assert.deepEqual(after.parts[0].measures[2].events.map(event => event.pitchMidi), [72, 72, 62, 67]);
  assert.equal(after.issues.filter(issue => issue.severity === 'error').length, 0);
  assert.ok(result.warnings.some(warning => /3마디.*다른 성부/.test(warning)));
});
