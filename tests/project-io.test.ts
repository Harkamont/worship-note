import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProject, serializeProject } from '../lib/project-io.ts';
import { createSampleScore } from '../lib/sample.ts';
import type { SavedProject } from '../lib/project-storage.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvRoAAAAASUVORK5CYII=';
const JPEG = 'data:image/jpeg;base64,/9j/2Q==';
const MIB = 1024 * 1024;
function project(): SavedProject {
  const score = createSampleScore();
  score.source = 'ai';
  return {
    score,
    originalImage: PNG,
    originalName: '오늘의 찬양.png',
    recognition: { model: 'vision-test-model', provider: 'openai-compatible', elapsedMs: 1234, usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300, cachedTokens: 10 } },
    updatedAt: '2026-10-18T11:22:33.444Z',
  };
}
function rawProject(): Record<string, unknown> {
  return { format: 'chanyang-project', version: 1, ...project() };
}

test('round trips original image, source, score and recognition in the versioned project bundle', () => {
  const original = project();
  const text = serializeProject(original);
  const bundle = JSON.parse(text);
  assert.equal(bundle.format, 'chanyang-project');
  assert.equal(bundle.version, 1);
  assert.deepEqual(parseProject(text), original);
});

test('imports old plain Score JSON without inventing an original or recognition result', () => {
  const score = createSampleScore();
  const restored = parseProject(JSON.stringify(score));
  assert.deepEqual(restored.score, score);
  assert.equal(restored.originalImage, null);
  assert.equal(restored.originalName, '');
  assert.equal(restored.recognition, null);
  assert.ok(Number.isFinite(Date.parse(restored.updatedAt)));
});

test('accepts JPEG and absent original images', () => {
  const jpeg = project();
  jpeg.originalImage = JPEG;
  jpeg.originalName = '원본.jpg';
  assert.deepEqual(parseProject(serializeProject(jpeg)), jpeg);
  jpeg.originalImage = null;
  jpeg.recognition = null;
  assert.deepEqual(parseProject(serializeProject(jpeg)), jpeg);
});

test('rejects non-image URLs, invalid base64 and MIME/signature mismatches', () => {
  for (const originalImage of [
    'https://example.test/song.png',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,not base64!',
    'data:image/png;base64,iVBORw0KGgo',
    'data:image/png;base64,/9j/2Q==',
    'data:image/jpeg;base64,iVBORw0KGgo=',
    'data:image/png;base64,aGVsbG8=',
  ]) {
    assert.throws(() => parseProject(JSON.stringify({ ...rawProject(), originalImage })));
  }
});

test('validates recognition fields and strips unexpected metadata instead of retaining it', () => {
  const input = rawProject();
  const recognition = { ...project().recognition!, unexpected: { nested: 'untrusted' }, usage: { ...project().recognition!.usage!, unexpected: 'untrusted' } };
  input.recognition = recognition;
  input.unexpected = 'untrusted';
  const restored = parseProject(JSON.stringify(input));
  assert.deepEqual(restored.recognition, project().recognition);
  assert.equal(JSON.stringify(restored).includes('untrusted'), false);
  const invalidMetadata = [
    {}, [], 'wrong',
    { ...recognition, model: { nested: 'bad' } },
    { ...recognition, model: '' },
    { ...recognition, provider: ['openai'] },
    { ...recognition, provider: 'bad\nprovider' },
    { ...recognition, elapsedMs: -1 },
    { ...recognition, elapsedMs: '1234' },
    { ...recognition, usage: { ...recognition.usage, inputTokens: -1 } },
    { ...recognition, usage: { ...recognition.usage, outputTokens: 0.5 } },
    { ...recognition, usage: { ...recognition.usage, totalTokens: '300' } },
    { ...recognition, usage: { ...recognition.usage, cachedTokens: 2_000_000_000 } },
  ];
  for (const invalid of invalidMetadata) assert.throws(() => parseProject(JSON.stringify({ ...rawProject(), recognition: invalid })));
  const nonfinite = project();
  nonfinite.recognition!.elapsedMs = Number.NaN;
  assert.throws(() => serializeProject(nonfinite));
});

test('rejects malformed version, score and invalid ISO calendar timestamps', () => {
  const malformed = rawProject();
  malformed.score = { ...project().score, tempo: 'fast' };
  assert.throws(() => parseProject(JSON.stringify(malformed)));
  for (const data of [null, [], {}, { ...rawProject(), format: 'another-format' }, { ...rawProject(), version: 2 }]) assert.throws(() => parseProject(JSON.stringify(data)));
  for (const updatedAt of ['yesterday', '2026-02-30T12:00:00.000Z', '2026-10-18', '2026-10-18T25:00:00.000Z']) assert.throws(() => parseProject(JSON.stringify({ ...rawProject(), updatedAt })));
  const withOffset = { ...rawProject(), updatedAt: '2026-10-18T12:00:00+09:00' };
  assert.equal(parseProject(JSON.stringify(withOffset)).updatedAt, withOffset.updatedAt);
});

test('bounds image, names, model, duration and entire JSON including UTF-8 byte length', () => {
  const oversizedImage = project();
  oversizedImage.originalImage = 'data:image/png;base64,' + 'A'.repeat(14 * MIB);
  assert.throws(() => serializeProject(oversizedImage));
  const tooLong = project();
  tooLong.originalName = '가'.repeat(257);
  assert.throws(() => serializeProject(tooLong));
  tooLong.originalName = '원본.png';
  tooLong.recognition!.model = 'x'.repeat(201);
  assert.throws(() => serializeProject(tooLong));
  tooLong.recognition!.model = 'test';
  tooLong.recognition!.elapsedMs = Number.MAX_SAFE_INTEGER;
  assert.throws(() => serializeProject(tooLong));
  assert.throws(() => parseProject(' '.repeat(45 * MIB + 1)));
  assert.throws(() => parseProject(JSON.stringify({ ...rawProject(), extra: '가'.repeat(16 * MIB) })));
});

test('preserves reported API cost without inventing one for old projects', () => {
  const original = project();
  const withCost = { ...original, recognition: { ...original.recognition!, cost: 0.00042 } };
  assert.deepEqual(parseProject(serializeProject(withCost)).recognition, withCost.recognition);
  assert.equal(Object.hasOwn(parseProject(serializeProject(original)).recognition!, 'cost'), false);
});

test('rejects malformed or nonfinite API costs in project files', () => {
  for (const cost of [-1, '0.01', null, Number.NaN, Infinity]) {
    const input = { ...project(), recognition: { ...project().recognition!, cost } };
    assert.throws(() => serializeProject(input as SavedProject));
  }
});
