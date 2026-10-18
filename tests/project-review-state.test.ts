import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewWorkspace } from '../lib/review-workspace.ts';
import { analyzeMusicXML } from '../lib/musicxml-review.ts';
import { parseProject, serializeProject } from '../lib/project-io.ts';
import { createSampleScore } from '../lib/sample.ts';
import type { MusicXMLRecognitionResult } from '../lib/recognition.ts';
import type { ProjectReviewAction } from '../lib/project-review-state.ts';

let helper: typeof import('../lib/project-review-state.ts') | undefined;
try { helper = await import('../lib/project-review-state.ts'); }
catch (error) { if (!(error instanceof Error) || !/Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) throw error; }

const image = 'data:image/png;base64,iVBORw0KGgo=';
function review(name: string) {
  const xml = `<score-partwise><work><work-title>${name}</work-title></work><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
  const result: MusicXMLRecognitionResult = { document: analyzeMusicXML(xml), score: null, editorIssue: null, provider: 'example', model: 'example', elapsedMs: 1, usage: null, cost: .01 };
  return { name, workspace: createReviewWorkspace(result, { sourceImage: image, sourceName: name + '.png', mode: 'local' }) };
}
type Review = ReturnType<typeof review>;
function reduce(state: { project: Review | null; candidate: Review | null }, action: ProjectReviewAction<Review>) {
  assert.ok(helper, 'project and candidate reviews must have separate state');
  return helper.projectReviewReducer<Review>(state, action);
}

test('reading another image preserves the current project review in autosave and ordinary JSON backups', () => {
  const original = review('현재 곡 A');
  original.workspace.editorChanged = true;
  original.workspace.measureRepair = { xml: original.workspace.sourceXML, selection: { partId: 'P1', startMeasure: 1, endMeasure: 1 }, receipts: [original.workspace.receipt] };
  const before = structuredClone(original);
  const candidate = review('새 후보 B');
  const state = reduce({ project: original, candidate: null }, { type: 'candidate', review: candidate });
  assert.equal(state.project, original);
  assert.equal(state.candidate, candidate);
  const project = { score: createSampleScore(), originalImage: image, originalName: '현재 곡 A.png', recognition: original.workspace.receipt, reviewWorkspace: state.project!.workspace, updatedAt: '2026-10-18T00:00:00Z' };
  const restored = parseProject(serializeProject(project));
  assert.deepEqual(restored.reviewWorkspace, before.workspace);
  assert.deepEqual(original, before);
});

test('closing an unimported candidate restores access to the connected review after reload', () => {
  const original = review('현재 곡 A');
  let state = reduce({ project: original, candidate: null }, { type: 'candidate', review: review('새 후보 B') });
  state = reduce(state, { type: 'update-active', update: current => ({ ...current, workspace: { ...current.workspace, melody: { selection: null, xml: null, warnings: ['후보에서만 고른 멜로디'] } } }) });
  assert.equal(state.project, original);
  assert.deepEqual(state.candidate?.workspace.melody.warnings, ['후보에서만 고른 멜로디']);
  state = reduce(state, { type: 'dismiss-candidate' });
  assert.equal(state.project, original);
  assert.equal(state.candidate, null);
  const reopened = reduce({ project: null, candidate: null }, { type: 'connect', review: structuredClone(state.project) });
  assert.deepEqual(reopened.project, original);
  assert.equal(reopened.candidate, null);
});

test('changing the current editor protects its connected review without modifying a different candidate', () => {
  const original = review('현재 곡 A');
  const candidate = review('새 후보 B');
  const state = reduce({ project: original, candidate }, { type: 'update-project', update: current => ({ ...current, workspace: { ...current.workspace, editorChanged: true } }) });
  assert.equal(state.project?.workspace.editorChanged, true);
  assert.equal(state.candidate, candidate);
  assert.equal(candidate.workspace.editorChanged, false);
  assert.equal(original.workspace.editorChanged, false);
});

test('melody selection in the current original review continues to update its saved review', () => {
  const original = review('현재 곡 A');
  const state = reduce({ project: original, candidate: null }, { type: 'update-active', update: current => ({ ...current, workspace: { ...current.workspace, melody: { selection: null, xml: null, warnings: ['보관할 선택'] } } }) });
  assert.deepEqual(state.project?.workspace.melody.warnings, ['보관할 선택']);
  assert.equal(state.project?.workspace.sourceXML, original.workspace.sourceXML);
  assert.equal(state.project?.workspace.receipt, original.workspace.receipt);
  assert.equal(state.candidate, null);
});

test('explicit import or repair application connects the selected review and retains its receipts', () => {
  const original = review('현재 곡 A');
  const candidate = review('새 후보 B');
  candidate.workspace.measureRepair = { xml: candidate.workspace.sourceXML, selection: { partId: 'P1', startMeasure: 1, endMeasure: 1 }, receipts: [candidate.workspace.receipt] };
  const state = reduce({ project: original, candidate }, { type: 'connect', review: candidate });
  assert.equal(state.project, candidate);
  assert.deepEqual(state.project?.workspace.measureRepair?.receipts, [candidate.workspace.receipt]);
  assert.equal(state.candidate, null);
  assert.deepEqual(reduce(state, { type: 'connect', review: null }), { project: null, candidate: null });
});
