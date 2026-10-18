import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMusicXML } from '../lib/musicxml-review.ts';
import { extractMusicXMLMelody } from '../lib/musicxml-melody.ts';
import { parseProject, serializeProject } from '../lib/project-io.ts';
import { createSampleScore } from '../lib/sample.ts';
import type { MusicXMLRecognitionResult } from '../lib/recognition.ts';

const xml = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>찬송가 원본</work-title></work><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><lyric number="1"><text>주님</text></lyric></note></measure></part></score-partwise>\n';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvRoAAAAASUVORK5CYII=';
const receipt = { model: 'original-paid-model', provider: 'local-omr + openai-compatible', elapsedMs: 44000, usage: { inputTokens: 300, outputTokens: 500, totalTokens: 800, cachedTokens: 0 }, cost: 0.025 };
const source = (): MusicXMLRecognitionResult => ({ ...receipt, document: { ...analyzeMusicXML(xml.slice(1)), xml }, score: null, editorIssue: 'untrusted cached issue' });
const selection = { partId: 'P1', staff: '1', voice: '1' };
async function api() {
  const mod = await import('../lib/review-workspace.ts').catch(() => null);
  assert.ok(mod && typeof mod.createReviewWorkspace === 'function', 'durable review workspace API must exist');
  return mod;
}

test('round trips exact source and derived XML, selection and paid receipt without cached analyses', async () => {
  const { createReviewWorkspace, restoreReviewWorkspace } = await api();
  const extraction = extractMusicXMLMelody(xml.slice(1), selection);
  const melody = { selection, xml: extraction.xml, warnings: extraction.warnings };
  const workspace = createReviewWorkspace(source(), { sourceImage: png, sourceName: '찬송가.png', mode: 'hybrid' }, melody);
  const saved = { score: createSampleScore(), originalImage: png, originalName: '편집기 원본.png', recognition: receipt, updatedAt: '2026-10-18T00:00:00Z', reviewWorkspace: workspace };
  const bundle = serializeProject(saved);
  assert.equal(bundle.includes('untrusted cached issue'), false);
  assert.equal(Object.hasOwn(JSON.parse(bundle).reviewWorkspace, 'document'), false);
  const parsed = parseProject(bundle);
  assert.deepEqual(parsed.reviewWorkspace, workspace);
  const restored = restoreReviewWorkspace(parsed.reviewWorkspace);
  assert.equal(restored.result.document.xml, xml);
  assert.ok(restored.result.score);
  assert.equal(restored.result.editorIssue, null);
  assert.equal(restored.melodyResult?.document.xml, extraction.xml);
  assert.deepEqual(restored.melodyResult?.usage, receipt.usage);
  assert.equal(restored.melodyResult?.cost, receipt.cost);
  assert.equal(restored.melodyResult?.provider, receipt.provider);
  assert.equal(restored.result.model, receipt.model);
});

test('selection without generation survives restore without generating XML or requesting AI', async () => {
  const { createReviewWorkspace, restoreReviewWorkspace } = await api();
  const workspace = createReviewWorkspace(source(), { sourceImage: null, sourceName: '원본.musicxml', mode: 'local' }, { selection, xml: null, warnings: [] });
  const restored = restoreReviewWorkspace(workspace);
  assert.deepEqual(restored.workspace.melody.selection, selection);
  assert.equal(restored.melodyResult, null);
  assert.equal(restored.workspace.melody.xml, null);
});

test('restore recomputes unsupported editor results while retaining downloadable exact XML', async () => {
  const { createReviewWorkspace, restoreReviewWorkspace } = await api();
  const input = source();
  input.document.xml = xml.replace('<type>whole</type>', '<type>whole</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
  const workspace = createReviewWorkspace(input, { sourceImage: null, sourceName: '복잡한.xml', mode: 'direct' });
  const restored = restoreReviewWorkspace(workspace);
  assert.equal(restored.result.score, null);
  assert.ok(restored.result.editorIssue);
  assert.equal(restored.result.document.xml, input.document.xml);
});

test('workspace rejects malformed, entity-bearing or oversized XML, damaged selection and unsafe metadata', async () => {
  const { createReviewWorkspace, normalizeReviewWorkspace } = await api();
  const valid = createReviewWorkspace(source(), { sourceImage: null, sourceName: '원본.xml', mode: 'direct' });
  for (const patch of [
    { version: 2 }, { mode: 'automatic-ai' }, { sourceXML: '<score-partwise>' },
    { sourceXML: '<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "file:///secret">]>' + xml },
    { sourceXML: ' '.repeat(2 * 1024 * 1024 + 1) },
    { sourceImage: 'https://example.test/source.png' }, { sourceName: 'bad\nname.xml' },
    { receipt: { ...receipt, cost: -1 } }, { receipt: { ...receipt, usage: { ...receipt.usage, totalTokens: Infinity } } },
    { melody: { selection: { ...selection, partId: 'missing' }, xml: null, warnings: [] } },
    { melody: { selection: null, xml, warnings: [] } },
    { melody: { selection, xml: '<score-partwise>', warnings: [] } },
    { melody: { selection, xml: null, warnings: ['x'.repeat(8001)] } },
  ]) assert.throws(() => normalizeReviewWorkspace({ ...valid, ...patch }));
  const normalized = normalizeReviewWorkspace({ ...valid, file: { secret: 'discard' }, result: source(), receipt: { ...receipt, apiKey: 'discard' } });
  assert.equal(JSON.stringify(normalized).includes('discard'), false);
  assert.equal(Object.hasOwn(normalized, 'result'), false);
});

test('project backup accepts two realistic 12MiB image copies and bounds total JSON at 45MiB', async () => {
  const { createReviewWorkspace } = await api();
  const image = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(12 * 1024 * 1024 - 11);
  const workspace = createReviewWorkspace(source(), { sourceImage: image, sourceName: '원본.png', mode: 'local' });
  const saved = { score: createSampleScore(), originalImage: image, originalName: '편집기.png', recognition: null, updatedAt: '2026-10-18T00:00:00Z', reviewWorkspace: workspace };
  assert.equal(parseProject(serializeProject(saved)).reviewWorkspace?.sourceImage, image);
  assert.throws(() => parseProject(' '.repeat(45 * 1024 * 1024 + 1)), /45MiB/);
});

test('source AI uncertainty survives JSON restore with code and location while structural issues are regenerated', async () => {
  const { createReviewWorkspace, restoreReviewWorkspace } = await api();
  const input = source();
  const notice = { severity: 'warning' as const, code: 'AI_TEXT_UNCERTAINTY', message: '2절 첫 가사가 흐려 원본과 확인해야 합니다.', partId: 'P1', measure: '1' };
  input.document.issues.push(notice, { ...notice }, { severity: 'error', code: 'STALE_CACHED_ERROR', message: '저장하면 안 되는 이전 구조 오류' });
  const workspace = createReviewWorkspace(input, { sourceImage: png, sourceName: '찬송가.png', mode: 'hybrid' });
  assert.deepEqual(workspace.sourceNotices, [notice]);
  const saved = { score: createSampleScore(), originalImage: png, originalName: '원본.png', recognition: receipt, updatedAt: '2026-10-18T00:00:00Z', reviewWorkspace: workspace };
  const bundle = serializeProject(saved);
  const restored = restoreReviewWorkspace(parseProject(bundle).reviewWorkspace);
  assert.deepEqual(restored.result.document.issues.filter(issue => issue.code === notice.code), [notice]);
  assert.equal(restored.result.document.issues.filter(issue => issue.code === 'SOURCE_COMPARISON_REQUIRED').length, 1);
  assert.equal(restored.result.document.issues.some(issue => issue.code === 'STALE_CACHED_ERROR'), false);
  assert.ok(restored.result.score);
  assert.equal(restored.result.document.xml, xml);
  const changed = restoreReviewWorkspace({ ...workspace, sourceXML: xml.replace('<duration>16</duration>', '<duration>0</duration>'), document: { issues: [], noteCount: 99999 }, score: createSampleScore() });
  assert.ok(changed.result.document.issues.some(issue => issue.severity === 'error'));
  assert.equal(changed.result.score, null);
  assert.equal(changed.result.document.noteCount, 1);
});

test('old workspaces default missing source notices to an empty array', async () => {
  const { createReviewWorkspace, normalizeReviewWorkspace, restoreReviewWorkspace } = await api();
  const workspace = createReviewWorkspace(source(), { sourceImage: null, sourceName: '기존.xml', mode: 'direct' });
  const legacy: Record<string, unknown> = { ...workspace };
  delete legacy.sourceNotices;
  assert.deepEqual(normalizeReviewWorkspace(legacy).sourceNotices, []);
  assert.ok(restoreReviewWorkspace(legacy).result.score);
});

test('source notices reject malformed fields, claimed errors and excessive text before project restore', async () => {
  const { createReviewWorkspace, normalizeReviewWorkspace } = await api();
  const workspace = createReviewWorkspace(source(), { sourceImage: null, sourceName: '원본.xml', mode: 'hybrid' });
  const notice = { severity: 'warning', code: 'AI_TEXT_UNCERTAINTY', message: '원본 대조 필요', partId: 'P1', measure: '1' };
  for (const sourceNotices of [
    null, {}, 'bad', [null], [{ ...notice, severity: 'error' }], [{ ...notice, severity: undefined }],
    [{ ...notice, code: '' }], [{ ...notice, code: 'x'.repeat(101) }], [{ ...notice, code: 'bad\ncode' }],
    [{ ...notice, message: 123 }], [{ ...notice, message: 'x'.repeat(8001) }], [{ ...notice, message: 'bad\u0000message' }],
    [{ ...notice, partId: 'x'.repeat(257) }], [{ ...notice, partId: null }], [{ ...notice, measure: {} }],
    Array.from({ length: 1001 }, (_, index) => ({ ...notice, message: String(index) })),
    Array.from({ length: 100 }, (_, index) => ({ ...notice, message: index + '가'.repeat(2000) })),
  ]) assert.throws(() => normalizeReviewWorkspace({ ...workspace, sourceNotices }));
  const normalized = normalizeReviewWorkspace({ ...workspace, sourceNotices: [{ ...notice, arbitrary: 'discard' }, notice] });
  assert.deepEqual(normalized.sourceNotices, [notice]);
});

test('partial AI repair keeps original XML and melody intact with cumulative receipts', async () => {
  const { createReviewWorkspace, normalizeReviewWorkspace, restoreReviewWorkspace } = await api();
  const base = createReviewWorkspace(source(), { sourceImage: null, sourceName: 'original.musicxml', mode: 'local' });
  const repaired = normalizeReviewWorkspace({ ...base, measureRepair: { xml, selection: { partId: 'P1', startMeasure: 1, endMeasure: 1 }, receipts: [{ model: 'repair-model', provider: 'openai-compatible', elapsedMs: 500, usage: null, cost: .002 }] } });
  assert.equal(repaired.sourceXML, base.sourceXML);
  assert.deepEqual(repaired.melody, base.melody);
  assert.equal(repaired.measureRepair?.receipts[0].cost, .002);
  const restored = restoreReviewWorkspace(repaired);
  assert.equal(restored.measureRepairResult?.document.xml, xml);
});

test('unknown partial AI costs never become zero during project restoration', async () => {
  const { createReviewWorkspace, normalizeReviewWorkspace, restoreReviewWorkspace } = await api();
  const base = createReviewWorkspace(source(), { sourceImage: null, sourceName: 'original.musicxml', mode: 'local' });
  const receipt = { model: 'repair', provider: 'openai-compatible', elapsedMs: 50, usage: null };
  const stored = normalizeReviewWorkspace({ ...base, measureRepair: { xml, selection:{partId:'P1',startMeasure:1,endMeasure:1}, receipts:[receipt] } });
  assert.equal(restoreReviewWorkspace(stored).measureRepairResult?.cost,undefined);
  assert.throws(()=>normalizeReviewWorkspace({...base,measureRepair:{xml,selection:{partId:'missing',startMeasure:1,endMeasure:1},receipts:[receipt]}}));
  assert.throws(()=>normalizeReviewWorkspace({...base,measureRepair:{xml,selection:{partId:'P1',startMeasure:1,endMeasure:1},receipts:Array(33).fill(receipt)}}));
});

test('editor divergence persists so a stale recognition XML cannot replace manual edits', async () => {
  const { createReviewWorkspace, normalizeReviewWorkspace, restoreReviewWorkspace } = await api();
  const workspace = createReviewWorkspace(source(), { sourceImage: null, sourceName: 'test.musicxml', mode: 'local' });
  const changed = normalizeReviewWorkspace({ ...workspace, editorChanged: true });
  assert.equal(changed.editorChanged, true);
  assert.equal(restoreReviewWorkspace(changed).workspace.editorChanged, true);
  assert.equal(normalizeReviewWorkspace({ ...changed, editorChanged: undefined }).editorChanged, true);
  assert.equal(workspace.editorChanged, false);
  assert.throws(() => normalizeReviewWorkspace({ ...workspace, editorChanged: 'yes' }));
});
