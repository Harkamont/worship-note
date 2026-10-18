import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { exportLyrics, exportMusicXML, transposeScore, validateScore } from '../lib/music.ts';
import { withNoteLyric } from '../lib/lyrics.ts';
import { parseProject, serializeProject } from '../lib/project-io.ts';
import { createSampleScore } from '../lib/sample.ts';
import { parseMusicXML, parseMusicXMLFile } from '../lib/musicxml-import.ts';

const attrs = '<attributes><divisions>4</divisions><key><fifths>3</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const note = (extra = '', duration = 16, type = 'whole') => `<note><pitch><step>A</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;
const scoreXML = (measures = `<measure number="1">${attrs}${note()}</measure>`, extra = '') => `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>내 악보 &amp; 노래</work-title></work><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>${extra}<part id="P1">${measures}</part></score-partwise>`;
const container = (path = 'scores/main.xml') => `<container><rootfiles><rootfile full-path="${path}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
const scoreData = (score: ReturnType<typeof parseMusicXML>) => score.sections.flatMap(section => section.measures).map(measure => ({ notes: measure.notes.map(({ pitch, duration, dots, tie, lyric }) => ({ pitch, duration, dots, tie, lyric })), chords: measure.chords.map(({ beat, symbol }) => ({ beat, symbol })) }));

test('imports the app MusicXML export without changing notes, dots, ties, chords or lyrics', () => {
  const original = createSampleScore();
  const measure = original.sections[0].measures[0];
  measure.notes[0].dots = 1;
  measure.notes[0].tie = true;
  measure.notes[1].pitch = measure.notes[0].pitch;
  measure.notes[1].duration = '8';
  measure.notes[0].lyric = '<가&사>';
  measure.chords[0].symbol = 'C/E';
  original.form = [{ id: 'ordered', sectionId: original.sections[0].id, repeat: 1 }];
  const imported = parseMusicXML(exportMusicXML(original));
  assert.deepEqual(scoreData(imported), scoreData({ ...original, sections: [original.sections[0]] }));
  assert.equal(imported.key, original.key);
  assert.equal(imported.tempo, original.tempo);
  assert.equal(imported.title, original.title);
});

test('imports minor keys, accidentals, rests and explicit assumptions', () => {
  const xml = scoreXML(`<measure number="1">${attrs.replace('<mode>major</mode>', '<mode>minor</mode>')}${note().replace('<step>A</step>', '<step>B</step><alter>-1</alter>')}</measure><measure number="2"><note><rest measure="yes"/><duration>16</duration></note></measure>`);
  const result = parseMusicXML(xml);
  assert.equal(result.key, 'F#m');
  assert.equal(result.title, '내 악보 & 노래');
  assert.equal(result.sections[0].measures[0].notes[0].pitch, 'Bb4');
  assert.equal(result.sections[0].measures[1].notes[0].pitch, null);
  assert.equal(result.tempo, 80);
  assert.match(result.warnings.join('\n'), /빠르기.*80/);
  assert.match(result.warnings.join('\n'), /구간.*전체/);
  assert.match(result.warnings.join('\n'), /원본.*확인/);
});

test('reports every rhythm mismatch together and does not pad missing beats', () => {
  const xml = scoreXML(`<measure number="1">${attrs}${note()}</measure><measure number="2">${note('', 8, 'half')}</measure><measure number="3">${note('', 4, 'quarter')}</measure>`);
  assert.throws(() => parseMusicXML(xml), (error: unknown) => error instanceof Error && /2마디.*2박/.test(error.message) && /3마디.*1박/.test(error.message));
});

test('rejects nominal note durations that disagree with the MusicXML duration', () => {
  assert.throws(() => parseMusicXML(scoreXML(`<measure number="1">${attrs}${note('', 16, 'quarter')}</measure>`)), /음표.*길이/);
});

test('rejects unsupported musical data instead of silently dropping notes', () => {
  for (const addition of ['<chord/>', '<grace/>', '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>', '<dot/><dot/>', '<unpitched><display-step>C</display-step><display-octave>4</display-octave></unpitched>']) {
    assert.throws(() => parseMusicXML(scoreXML(`<measure number="1">${attrs}${note(addition)}</measure>`)));
  }
  assert.throws(() => parseMusicXML(scoreXML(`<measure number="1">${attrs}<backup><duration>16</duration></backup>${note()}</measure>`)), /backup|다성부|되감기/);
  assert.throws(() => parseMusicXML(scoreXML(`<measure number="1">${attrs}${note().replace('<voice>1</voice>', '<voice>2</voice>')}${note()}</measure>`)), /성부/);
  assert.throws(() => parseMusicXML(scoreXML(`<measure number="1">${attrs.replace('</attributes>', '<staves>2</staves></attributes>')}${note()}</measure>`)), /보표/);
  assert.throws(() => parseMusicXML(scoreXML(undefined, '<part id="P2"><measure number="1"/></part>')), /파트/);
});

test('rejects changes of meter and key rather than reinterpreting notes', () => {
  assert.throws(() => parseMusicXML(scoreXML(`<measure number="1">${attrs}${note()}</measure><measure number="2">${attrs.replace('<beats>4</beats>', '<beats>3</beats>')}${note()}</measure>`)), /박자 변경/);
  assert.throws(() => parseMusicXML(scoreXML(`<measure number="1">${attrs}${note()}</measure><measure number="2">${attrs.replace('<fifths>3</fifths>', '<fifths>0</fifths>')}${note()}</measure>`)), /조성 변경/);
});

test('reads harmony offsets relative to the current note position', () => {
  const harmony = '<harmony><root><root-step>F</root-step><root-alter>1</root-alter></root><kind text="m7">minor-seventh</kind><bass><bass-step>C</bass-step><bass-alter>1</bass-alter></bass><offset>2</offset></harmony>';
  const result = parseMusicXML(scoreXML(`<measure number="1">${attrs}${note('', 8, 'half')}${harmony}${note('', 8, 'half')}</measure>`));
  assert.deepEqual(result.sections[0].measures[0].chords.map(({ beat, symbol }) => ({ beat, symbol })), [{ beat: 3.5, symbol: 'F#m7/C#' }]);
});

test('uses the semantic chord kind when its display text is empty', () => {
  const harmony = '<harmony><root><root-step>C</root-step></root><kind text="">minor-seventh</kind></harmony>';
  const result = parseMusicXML(scoreXML(`<measure number="1">${attrs}${harmony}${note()}</measure>`));
  assert.equal(result.sections[0].measures[0].chords[0].symbol, 'Cm7');
});

test('imports added second and ninth degrees once while preserving quality, bass and alterations', () => {
  for (const [kind, degree, expected] of [
    ['<kind text="add2">major</kind>', '<degree print-object="no"><degree-value>2</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>', 'F#add2/C#'],
    ['<kind>minor</kind>', '<degree><degree-value>9</degree-value><degree-alter>-1</degree-alter><degree-type>add</degree-type></degree>', 'F#maddb9/C#'],
    ['<kind text="m7(#9)">minor-seventh</kind>', '<degree print-object="no"><degree-value>9</degree-value><degree-alter>1</degree-alter><degree-type>add</degree-type></degree>', 'F#m7(#9)/C#'],
    ['<kind text="min(add9)">minor</kind>', '<degree print-object="no"><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>', 'F#min(add9)/C#'],
  ]) {
    const harmony = `<harmony><root><root-step>F</root-step><root-alter>1</root-alter></root>${kind}<bass><bass-step>C</bass-step><bass-alter>1</bass-alter></bass>${degree}</harmony>`;
    const result = parseMusicXML(scoreXML(`<measure number="1">${attrs}${harmony}${note()}</measure>`));
    assert.equal(result.sections[0].measures[0].chords[0].symbol, expected);
    assert.deepEqual(scoreData(parseMusicXML(exportMusicXML(result))), scoreData(result));
  }
});

test('retains whole-chord parentheses through import, transposition and MusicXML export', () => {
  for (const [root, kind, bass, expected, moved] of [
    ['<root-step text="(B">B</root-step>', '<kind text="m7)">minor-seventh</kind>', '', '(Bm7)', '(C#m7)'],
    ['<root-step text="(F">F</root-step><root-alter>1</root-alter>', '<kind text="m7">minor-seventh</kind>', '<bass><bass-step text="C#)">C</bass-step><bass-alter print-object="no">1</bass-alter></bass>', '(F#m7/C#)', '(G#m7/D#)'],
  ]) {
    const harmony = `<harmony><root>${root}</root>${kind}${bass}</harmony>`;
    const result = parseMusicXML(scoreXML(`<measure number="1">${attrs}${harmony}${note()}</measure>`));
    assert.equal(result.sections[0].measures[0].chords[0].symbol, expected);
    const transposed = transposeScore(result, 'B');
    assert.equal(transposed.sections[0].measures[0].chords[0].symbol, moved);
    const exported = exportMusicXML(transposed);
    assert.match(exported, /root-step text="\(/);
    assert.deepEqual(scoreData(parseMusicXML(exported)), scoreData(transposed));
  }
});

test('reports unsupported or contradictory harmony degrees rather than discarding them', () => {
  for (const [degreeValue, alter, type, display] of [
    ['9', '0', 'alter', ''], ['3', '0', 'subtract', ''], ['9', '0.5', 'add', ''],
    ['11', '0', 'add', ''], ['2', '0', 'add', 'add9'],
  ]) {
    const harmony = `<harmony><root><root-step>C</root-step></root><kind text="${display}">major</kind><degree><degree-value>${degreeValue}</degree-value><degree-alter>${alter}</degree-alter><degree-type>${type}</degree-type></degree></harmony>`;
    assert.throws(() => parseMusicXML(scoreXML(`<measure number="1">${attrs}${harmony}${note()}</measure>`)), /degree|코드.*추가음/);
  }
});

test('retains every lyric verse and warns about flattened elision and unsupported slurs', () => {
  const result = parseMusicXML(scoreXML(`<measure number="1">${attrs}${note('<notations><slur type="start"/></notations><lyric number="1"><text>가</text><elision> </elision><text>사</text></lyric><lyric number="2"><text>다른 절</text></lyric>')}</measure>`));
  assert.equal(result.sections[0].measures[0].notes[0].lyric, '가 사');
  assert.equal(result.sections[0].measures[0].notes[0].lyrics?.[1].text, '다른 절');
  assert.match(result.warnings.join('\n'), /elision/);
  assert.ok(!result.warnings.some(warning => /첫.*절만/.test(warning)));
  assert.match(result.warnings.join('\n'), /이음줄/);
});

test('reads an explicit metronome without mistaking it for missing tempo', () => {
  const metronome = '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>92</per-minute></metronome></direction-type></direction>';
  const result = parseMusicXML(scoreXML(`<measure number="1">${attrs}${metronome}${note()}</measure>`));
  assert.equal(result.tempo, 92);
  assert.ok(!result.warnings.some(warning => warning.includes('80 BPM')));
});

test('rejects an orphan tie stop instead of silently discarding it', () => {
  assert.throws(() => parseMusicXML(scoreXML(`<measure number="1">${attrs}${note('<tie type="stop"/>')}</measure>`)), /붙임줄/);
});

test('bounds actual MXL expansion even when its declared size is forged', async () => {
  const compressed = zipSync({ 'large.xml': new Uint8Array(2 * 1024 * 1024 + 1) });
  new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength).setUint32(22, 1, true);
  await assert.rejects(parseMusicXMLFile(compressed, 'score.mxl'), /크기|2MB/);
});

test('permits the standard MusicXML DTD without fetching and rejects custom entities and malformed XML', () => {
  assert.equal(parseMusicXML(scoreXML().replace('<score-partwise', '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise')).key, 'A');
  for (const xml of [scoreXML().replace('<score-partwise', '<!DOCTYPE score-partwise [<!ENTITY xxe SYSTEM "file:///private.txt">]><score-partwise'), scoreXML().replace('내 악보', '&unknown;'), scoreXML().replace('</note>', '</other>')]) assert.throws(() => parseMusicXML(xml), /XML|엔터티/);
  assert.throws(() => parseMusicXML('x'.repeat(2 * 1024 * 1024 + 1)), /2MB/);
});

test('imports plain UTF-8 XML and compressed MXL through the same API', async () => {
  const xml = scoreXML();
  const plain = await parseMusicXMLFile(strToU8(xml), '악보.musicxml');
  const compressed = await parseMusicXMLFile(zipSync({ 'META-INF/container.xml': strToU8(container()), 'scores/main.xml': strToU8(xml) }), '악보.mxl');
  assert.deepEqual(scoreData(compressed), scoreData(plain));
});

test('rejects missing or unsafe MXL root files and excessive expanded content', async () => {
  const archives: Zippable[] = [
    { 'scores/main.xml': strToU8(scoreXML()) },
    { 'META-INF/container.xml': strToU8(container('../main.xml')), '../main.xml': strToU8(scoreXML()) },
    { 'META-INF/container.xml': strToU8(container()), 'scores/main.xml': new Uint8Array(2 * 1024 * 1024 + 1) },
    { 'META-INF/container.xml': strToU8(container()), 'scores/main.xml': strToU8(scoreXML()), 'large.bin': new Uint8Array(8 * 1024 * 1024 + 1) },
  ];
  for (const files of archives) await assert.rejects(parseMusicXMLFile(zipSync(files), 'score.mxl'));
  await assert.rejects(parseMusicXMLFile(new Uint8Array(10 * 1024 * 1024 + 1), 'score.mxl'), /10MB/);
  await assert.rejects(parseMusicXMLFile(strToU8(scoreXML()), 'score.exe'), /확장자/);
});

test('warns when unsupported ornament and performance marks are omitted', () => {
  const result = parseMusicXML(scoreXML(`<measure number="1">${attrs}${note('<notations><ornaments><trill-mark/></ornaments><fermata/></notations>')}</measure>`));
  assert.match(result.warnings.join('\n'), /장식.*연주.*표시하지/);
});

test('imports and exports every numbered lyric with syllabic, melisma and explicit line endings',()=>{
  const lyric=(number:string,inside:string)=>`<lyric number="${number}">${inside}</lyric>`;
  const source=scoreXML(`<measure number="1">${attrs}${note(lyric('1','<syllabic>single</syllabic><text>주</text><extend type="start"/>')+lyric('2','<syllabic>begin</syllabic><text>Ama</text>'),4,'quarter')}${note(lyric('1','<extend type="continue"/>')+lyric('2','<syllabic>end</syllabic><text>zing</text>'),4,'quarter')}${note(lyric('1','<extend type="stop"/><end-line/>'),4,'quarter')}${note(lyric('1','<text>self-giving</text><end-line/>')+lyric('2','<syllabic>single</syllabic><text>grace</text>'),4,'quarter')}</measure>`);
  const imported=parseMusicXML(source);const notes=imported.sections[0].measures[0].notes;
  assert.deepEqual(notes[0].lyrics,[{number:'1',text:'주',syllabic:'single',extend:'start'},{number:'2',text:'Ama',syllabic:'begin'}]);
  assert.deepEqual(notes[1].lyrics,[{number:'1',text:'',extend:'continue'},{number:'2',text:'zing',syllabic:'end'}]);
  assert.deepEqual(notes[2].lyrics,[{number:'1',text:'',extend:'stop',endLine:true}]);
  assert.equal(notes[3].lyric,'self-giving');
  const roundtrip=parseMusicXML(exportMusicXML(imported));
  assert.deepEqual(roundtrip.sections[0].measures[0].notes.map(n=>n.lyrics),notes.map(n=>n.lyrics));
  assert.ok(!imported.warnings.some(w=>/첫.*절만/.test(w)));
});

test('imports an untyped MusicXML extend as start and rejects invalid syllabic or extend types',()=>{
  const imported=parseMusicXML(scoreXML(`<measure number="1">${attrs}${note('<lyric><text>길</text><extend/></lyric>')}</measure>`));
  assert.deepEqual(imported.sections[0].measures[0].notes[0].lyrics,[{number:'1',text:'길',extend:'start'}]);
  for(const mark of ['<syllabic>wrong</syllabic><text>가</text>','<text>가</text><extend type="wrong"/>'])assert.throws(()=>parseMusicXML(scoreXML(`<measure number="1">${attrs}${note(`<lyric>${mark}</lyric>`)}</measure>`)),/가사/);
});


test('fixes one primary lyric verse across notes with a secondary-only melisma gap',()=>{
  const first='<lyric number="1"><syllabic>begin</syllabic><text>하</text><extend type="start"/></lyric><lyric number="2"><syllabic>single</syllabic><text>Lord</text></lyric>';
  const second='<lyric number="2"><syllabic>single</syllabic><text>my</text></lyric>';
  const third='<lyric number="1"><syllabic>end</syllabic><text>나님</text></lyric><lyric number="2"><syllabic>single</syllabic><text>God</text></lyric>';
  const imported=parseMusicXML(scoreXML(`<measure number="1">${attrs}${note(first,4,'quarter')}${note(second,4,'quarter')}${note(third,4,'quarter')}${note('',4,'quarter')}</measure>`));
  const notes=imported.sections[0].measures[0].notes;
  assert.deepEqual(notes.map(n=>n.lyric),['하','','나님','']);
  assert.deepEqual(notes[1].lyrics,[{number:'1',text:''},{number:'2',text:'my',syllabic:'single'}]);
  assert.equal(exportLyrics(imported,{verse:'1',sectionNames:false}),'하나님');
  assert.equal(exportLyrics(imported,{verse:'2',sectionNames:false}),'Lord my God');
  assert.deepEqual(parseMusicXML(exportMusicXML(imported)).sections[0].measures[0].notes.map(n=>n.lyrics),notes.map(n=>n.lyrics));
});

test('uses the first global identifier when verse one is absent and keeps empty notes in that verse',()=>{
  const first='<lyric number="2"><syllabic>single</syllabic><text>우리</text></lyric>';
  const second='<lyric number="3"><syllabic>single</syllabic><text>Grace</text></lyric>';
  const fourth='<lyric number="2"><syllabic>single</syllabic><text>주</text></lyric>';
  const imported=parseMusicXML(scoreXML(`<measure number="1">${attrs}${note(first,4,'quarter')}${note(second,4,'quarter')}${note('',4,'quarter')}${note(fourth,4,'quarter')}</measure>`));
  const notes=imported.sections[0].measures[0].notes;
  assert.deepEqual(notes.map(n=>n.lyric),['우리','','','주']);
  assert.deepEqual(notes[1].lyrics,[{number:'2',text:''},{number:'3',text:'Grace',syllabic:'single'}]);
  assert.deepEqual(notes[2].lyrics,[{number:'2',text:''}]);
  assert.equal(exportLyrics(imported,{verse:'2',sectionNames:false}),'우리 주');
  assert.equal(exportLyrics(imported,{verse:'3',sectionNames:false}),'Grace');
  const changed=withNoteLyric(notes[2],'새말');
  assert.deepEqual(changed.lyrics,[{number:'2',text:'새말'}]);
  assert.equal(notes[2].lyric,'');
  imported.sections[0].measures[0].notes[2]=changed;
  assert.deepEqual(validateScore(imported).sections[0].measures[0].notes[2].lyrics,[{number:'2',text:'새말'}]);
});

test('editing a missing primary verse fills that verse while preserving secondary text',()=>{
  const imported=parseMusicXML(scoreXML(`<measure number="1">${attrs}${note('<lyric number="1"><text>첫절</text></lyric>',8,'half')}${note('<lyric number="2"><text>다른 절</text></lyric>',8,'half')}</measure>`));
  const noteToEdit=imported.sections[0].measures[0].notes[1];
  const edited=withNoteLyric(noteToEdit,'추가');
  assert.deepEqual(edited.lyrics,[{number:'1',text:'추가'},{number:'2',text:'다른 절'}]);
  assert.equal(noteToEdit.lyric,'');
  assert.equal(exportLyrics(imported,{verse:'2',sectionNames:false}),'다른 절');
});


test('verse one discovered later in the part stays primary through project serialization',()=>{
  const imported=parseMusicXML(scoreXML(`<measure number="1">${attrs}${note('<lyric number="2"><text>둘째</text></lyric>',8,'half')}${note('<lyric number="1"><text>첫째</text></lyric>',8,'half')}</measure>`));
  assert.deepEqual(imported.sections[0].measures[0].notes.map(note=>note.lyric),['','첫째']);
  const restored=parseProject(serializeProject({score:imported,originalImage:null,originalName:'',recognition:null,updatedAt:'2026-10-18T00:00:00.000Z'})).score;
  assert.deepEqual(restored.sections[0].measures[0].notes[0].lyrics,[{number:'1',text:''},{number:'2',text:'둘째'}]);
  assert.equal(exportLyrics(restored,{verse:'2',sectionNames:false}),'둘째');
});
