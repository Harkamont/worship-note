import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { durationBeats, exportMusicXML, transposeScore, validateScore } from '../lib/music.ts';
import { parseMusicXML, parseMusicXMLFile } from '../lib/musicxml-import.ts';
import { parseProject, serializeProject } from '../lib/project-io.ts';

const attributes = '<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const note = (beats = 4, type = 'whole', pitch = '<step>C</step>', extra = '') => `<note><pitch>${pitch}<octave>4</octave></pitch><duration>${beats * 4}</duration><type>${type}</type>${extra}</note>`;
const measure = (inside: string, extra = '') => `<measure number="1"${extra}>${inside}</measure>`;
const xml = (measures: string) => `<score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
const malformed = () => xml(measure(attributes + note()) + measure(note(1, 'quarter')) + measure(note() + note(1, 'quarter')));
const content = (score: ReturnType<typeof parseMusicXML>) => score.sections[0].measures.map(measure => measure.notes.map(({ pitch, duration, dots }) => ({ pitch, duration, dots })));

test('review import keeps short and overfull middle bars unchanged only after explicit opt-in', () => {
  assert.throws(() => parseMusicXML(malformed()), /2마디.*1박[\s\S]*3마디.*5박/);
  const score = parseMusicXML(malformed(), { reviewDraft: true });
  assert.deepEqual(score.sections[0].measures.map(measure => measure.rhythmReview), [undefined, true, true]);
  assert.deepEqual(score.sections[0].measures.map(measure => measure.actualBeats), [undefined, undefined, undefined]);
  assert.deepEqual(score.sections[0].measures.map(measure => measure.notes.reduce((total, note) => total + durationBeats(note), 0)), [4, 1, 5]);
  assert.match(score.warnings.join('\n'), /2마디.*1박.*4박.*수정/);
  assert.match(score.warnings.join('\n'), /3마디.*5박.*4박.*수정/);
});

test('draft markers survive saving and transposition, and disappear once the notes match the expected length', () => {
  const draft = parseMusicXML(malformed(), { reviewDraft: true });
  const restored = parseProject(serializeProject({ score: draft, originalImage: null, originalName: '', recognition: null, updatedAt: '2026-10-18T00:00:00.000Z' })).score;
  assert.equal(transposeScore(restored, 'D').sections[0].measures[1].rhythmReview, true);
  restored.sections[0].measures[1].notes[0].duration = 'w';
  assert.equal(validateScore(restored).sections[0].measures[1].rhythmReview, undefined);
  assert.equal(validateScore(restored).sections[0].measures[2].rhythmReview, true);
  const missingMarker = structuredClone(draft);
  delete missingMarker.sections[0].measures[1].rhythmReview;
  assert.throws(() => validateScore(missingMarker), /음표 길이 합/);
  assert.throws(() => validateScore({ ...draft, sections: [{ ...draft.sections[0], measures: [{ ...draft.sections[0].measures[1], rhythmReview: false }] }] }), /리듬|검토/);
});

test('review markers do not bypass note validation, count bounds or supported rhythm types', () => {
  const draft = parseMusicXML(malformed(), { reviewDraft: true });
  draft.sections[0].measures[1].notes[0].pitch = 'H4';
  assert.throws(() => validateScore(draft), /음높이/);
  for (const extra of ['<grace/>', '<time-modification><actual-notes>3</actual-notes></time-modification>']) {
    assert.throws(() => parseMusicXML(xml(measure(attributes + note()) + measure(note(1, 'quarter', '<step>C</step>', extra))), { reviewDraft: true }));
  }
  assert.throws(() => parseMusicXML(xml(measure(attributes + note()) + measure(note(1, 'whole'))), { reviewDraft: true }), /종류.*길이/);
});

test('an explicitly marked empty rhythm draft autosaves without inventing notes and keeps hard chord bounds', () => {
  const draft = parseMusicXML(malformed(), { reviewDraft: true });
  const empty = draft.sections[0].measures[1];
  empty.notes = [];
  empty.chords = [{ id: 'empty-draft-chord', beat: 4.75, symbol: 'C' }];
  const validated = validateScore(draft);
  assert.deepEqual(validated.sections[0].measures[1].notes, []);
  assert.equal(validated.sections[0].measures[1].rhythmReview, true);
  const restored = parseProject(serializeProject({ score: draft, originalImage: null, originalName: '', recognition: null, updatedAt: '2026-10-18T00:00:00.000Z' })).score;
  assert.deepEqual(restored.sections[0].measures[1].notes, []);
  assert.equal(restored.sections[0].measures[1].rhythmReview, true);
  empty.chords[0].beat = 385;
  assert.throws(() => validateScore(draft), /코드/);
  empty.chords[0].beat = 1;
  delete empty.rhythmReview;
  assert.throws(() => validateScore(draft), /음표|항목 수/);
});

test('only an explicit review import retains an empty source bar, and export adds no placeholder notes', () => {
  const source = xml(measure(attributes + note()) + measure(''));
  assert.throws(() => parseMusicXML(source), /2마디.*0박/);
  const draft = parseMusicXML(source, { reviewDraft: true });
  assert.deepEqual(draft.sections[0].measures[1].notes, []);
  assert.equal(draft.sections[0].measures[1].rhythmReview, true);
  const exported = exportMusicXML(draft);
  const second = exported.match(/<measure number="2"[^>]*>([\s\S]*?)<\/measure>/)![1];
  assert.doesNotMatch(second, /<note>|<rest/);
  assert.deepEqual(parseMusicXML(exported, { reviewDraft: true }).sections[0].measures[1].notes, []);
});

test('draft chords retain their onsets inside the larger of expected and actual note lengths', () => {
  const draft = parseMusicXML(malformed(), { reviewDraft: true });
  const short = draft.sections[0].measures[1];
  const overfull = draft.sections[0].measures[2];
  short.chords = [{ id: 'short-chord', symbol: 'C', beat: 4 }];
  overfull.chords = [{ id: 'overfull-chord', symbol: 'G', beat: 5.75 }];
  assert.deepEqual(validateScore(draft).sections[0].measures[2].chords, overfull.chords);
  overfull.chords[0].beat = 385;
  assert.throws(() => validateScore(draft), /코드/);
});

test('review keeps an existing fifth-beat chord after notes are shortened until the chord position is corrected', () => {
  const draft = parseMusicXML(malformed(), { reviewDraft: true });
  const overfull = draft.sections[0].measures[2];
  overfull.chords = [{ id: 'retained-fifth-beat', symbol: 'G', beat: 5 }];
  overfull.notes = [overfull.notes[0]];
  const validated = validateScore(draft);
  assert.equal(validated.sections[0].measures[2].rhythmReview, true);
  assert.equal(validated.sections[0].measures[2].chords[0].beat, 5);
  const restored = parseProject(serializeProject({ score: draft, originalImage: null, originalName: '', recognition: null, updatedAt: '2026-10-18T00:00:00.000Z' })).score;
  assert.equal(restored.sections[0].measures[2].chords[0].beat, 5);
  overfull.chords[0].beat = 384.75;
  assert.equal(validateScore(draft).sections[0].measures[2].chords[0].beat, 384.75);
  overfull.chords[0].beat = 385;
  assert.throws(() => validateScore(draft), /코드/);
  overfull.chords[0].beat = 5;
  delete overfull.rhythmReview;
  assert.throws(() => validateScore(draft), /코드/);
  overfull.rhythmReview = true;
  overfull.chords[0].beat = 4;
  assert.equal(validateScore(draft).sections[0].measures[2].rhythmReview, undefined);
});

test('a chord-only review marker and export warning persist without moving or dropping the chord', () => {
  const harmony = '<harmony><root><root-step>G</root-step></root><kind>major</kind><offset>16</offset></harmony>';
  const source = xml(measure(attributes + note()) + measure(harmony + note()));
  assert.throws(() => parseMusicXML(source), /코드/);
  const draft = parseMusicXML(source, { reviewDraft: true });
  assert.equal(draft.sections[0].measures[1].rhythmReview, true);
  assert.match(draft.warnings.join('\n'), /2마디.*코드.*5/);
  const exported = exportMusicXML(draft);
  assert.match(exported, /리듬 검토 필요[^<]*코드/);
  assert.doesNotMatch(exported, /implicit="yes"/);
  const restored = parseMusicXML(exported, { reviewDraft: true });
  assert.equal(restored.sections[0].measures[1].chords[0].beat, 5);
  assert.equal(restored.sections[0].measures[1].rhythmReview, true);
});

test('review exports keep malformed durations without mislabeling them as pickups', () => {
  const source = xml(measure(attributes + note(0.5, 'eighth')) + measure(note(1, 'quarter')) + measure(note() + note(1, 'quarter')));
  const draft = parseMusicXML(source, { reviewDraft: true });
  const exported = exportMusicXML(draft);
  assert.equal((exported.match(/implicit="yes"/g) ?? []).length, 1);
  assert.match(exported, /리듬 검토 필요/);
  assert.deepEqual(content(parseMusicXML(exported, { reviewDraft: true })), content(draft));
  assert.throws(() => parseMusicXML(exported), /2마디/);
});

test('an explicit non-implicit first short bar stays a review problem instead of becoming a pickup', () => {
  const source = xml(measure(attributes + note(1, 'quarter'), ' implicit="no"'));
  assert.throws(() => parseMusicXML(source), /1마디.*1박.*4박/);
  const draft = parseMusicXML(source, { reviewDraft: true });
  assert.equal(draft.sections[0].measures[0].rhythmReview, true);
  assert.equal(draft.sections[0].measures[0].actualBeats, undefined);
  const exported = exportMusicXML(draft);
  assert.match(exported, /<measure number="1" implicit="no">/);
  assert.throws(() => parseMusicXML(exported), /1마디/);
  const restored = parseMusicXML(exported, { reviewDraft: true });
  assert.equal(restored.sections[0].measures[0].rhythmReview, true);
  assert.equal(restored.sections[0].measures[0].actualBeats, undefined);
});

test('a flagged pickup export preserves its expected shorter length using bounded review metadata', () => {
  const draft = parseMusicXML(xml(measure(attributes + note(1.5, 'quarter', '<step>C</step>', '<dot/>'))));
  const first = draft.sections[0].measures[0];
  first.notes[0].duration = '8';
  first.notes[0].dots = 0;
  first.rhythmReview = true;
  const exported = exportMusicXML(draft);
  assert.match(exported, /implicit="no"/);
  assert.match(exported, /id="chanyang-review-m1-beats-1.5"/);
  assert.throws(() => parseMusicXML(exported), /1마디.*0.5박.*1.5박/);
  const restored = parseMusicXML(exported, { reviewDraft: true }).sections[0].measures[0];
  assert.equal(restored.actualBeats, 1.5);
  assert.equal(restored.rhythmReview, true);
  assert.equal(durationBeats(restored.notes[0]), 0.5);
  assert.throws(() => parseMusicXML(exported.replace('beats-1.5', 'beats-5'), { reviewDraft: true }), /마디 실제 길이/);
});

test('many indexed import warnings remain bounded without losing review flags for later bars', () => {
  const source = xml(Array.from({ length: 128 }, (_, index) => measure((index === 0 ? attributes : '') + note(1, 'quarter'), ' implicit="no"')).join(''));
  const draft = parseMusicXML(source, { reviewDraft: true });
  assert.equal(draft.sections[0].measures.length, 128);
  assert.ok(draft.sections[0].measures.every(measure => measure.rhythmReview === true));
  assert.equal(draft.warnings.length, 100);
  assert.match(draft.warnings.at(-1)!, /\d+개.*생략/);
});

test('review import keeps the first displayed key while retaining absolute pitch and alter data', () => {
  const source = xml(measure(attributes + note(4, 'whole', '<step>F</step>')) + measure('<attributes><key><fifths>1</fifths></key></attributes>' + note(4, 'whole', '<step>F</step><alter>1</alter>')) + measure(note(4, 'whole', '<step>F</step>')));
  assert.throws(() => parseMusicXML(source), /조성 변경/);
  const draft = parseMusicXML(source, { reviewDraft: true });
  assert.equal(draft.key, 'C');
  assert.deepEqual(draft.sections[0].measures.map(measure => measure.notes[0].pitch), ['F4', 'F#4', 'F4']);
  assert.match(draft.warnings.join('\n'), /2마디.*조표.*G.*C.*음높이/);
  assert.ok(draft.sections[0].measures.every(measure => measure.rhythmReview === undefined));
});

test('review import represents forward gaps with exact rests and retains subsequent note onsets', () => {
  const source = xml(measure(attributes + note()) + measure(note(1, 'quarter') + '<forward><duration>2</duration></forward>' + note(1, 'quarter') + note(1.5, 'quarter', '<step>D</step>', '<dot/>')));
  assert.throws(() => parseMusicXML(source), /forward/);
  const imported = parseMusicXML(source, { reviewDraft: true });
  const second = imported.sections[0].measures[1];
  assert.deepEqual(second.notes.map(note => [note.pitch, durationBeats(note)]), [['C4', 1], [null, 0.5], ['C4', 1], ['D4', 1.5]]);
  assert.equal(second.rhythmReview, undefined);
  assert.match(imported.warnings.join('\n'), /2마디.*forward.*0.5박.*쉼표/);
  const dottedGap = xml(measure(attributes + note()) + measure(note(1, 'quarter') + '<forward><duration>1.5</duration></forward>' + note(1, 'quarter')));
  const notes = parseMusicXML(dottedGap, { reviewDraft: true }).sections[0].measures[1].notes;
  assert.equal(notes[1].pitch, null);
  assert.equal(durationBeats(notes[1]), 0.375);
});

test('review import rejects negative or unrepresentable forward gaps and ties across silence', () => {
  for (const duration of [-4, 0, 0.5]) {
    assert.throws(() => parseMusicXML(xml(measure(attributes + note()) + measure(note(1, 'quarter') + `<forward><duration>${duration}</duration></forward>` + note(1, 'quarter'))), { reviewDraft: true }), /forward|빈 시간|음표|쉼표/);
  }
  assert.throws(() => parseMusicXML(xml(measure(attributes + note(1, 'quarter', '<step>C</step>', '<tie type="start"/>') + '<forward><duration>4</duration></forward>' + note(2, 'half', '<step>C</step>', '<tie type="stop"/>'))), { reviewDraft: true }), /붙임줄/);
  assert.throws(() => parseMusicXML(xml(measure(attributes + '<forward><duration>4</duration><voice>2</voice></forward>' + note(1, 'quarter', '<step>C</step>', '<voice>1</voice>'))), { reviewDraft: true }), /성부/);
});

test('plain and compressed file imports forward the explicit review option', async () => {
  const bytes = strToU8(malformed());
  await assert.rejects(parseMusicXMLFile(bytes, 'draft.musicxml'), /2마디/);
  const plain = await parseMusicXMLFile(bytes, 'draft.musicxml', { reviewDraft: true });
  const manifest = '<container><rootfiles><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';
  const compressed = await parseMusicXMLFile(zipSync({ 'META-INF/container.xml': strToU8(manifest), 'score.xml': bytes }), 'draft.mxl', { reviewDraft: true });
  assert.deepEqual(content(plain), content(compressed));
  assert.equal(compressed.sections[0].measures[1].rhythmReview, true);
});
