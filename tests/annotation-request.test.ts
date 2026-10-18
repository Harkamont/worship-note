import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as recognition from '../lib/recognition.ts';
import type { RecognitionResult, Score } from '../lib/score-types.ts';

const env = { OPENAI_API_KEY: 'test-only-secret', AI_MODEL: 'main-model', AI_ANNOTATION_MODEL: 'annotation-model' };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
const score: Score = {
  version: 1, title: '원래 제목', artist: '원래 작곡자', key: 'C', timeSignature: '4/4', tempo: 80,
  sections: [{ id: 's1', label: 'Verse 1', type: 'verse', measures: [{ id: 'm1',
    notes: ['C4', 'D4', 'E4', 'F4'].map((pitch, i) => ({ id: `n${i}`, pitch, duration: 'q', dots: 0, lyric: '', tie: false })),
    chords: [{ id: 'c1', beat: 1, symbol: 'C' }],
  }] }], form: [{ id: 'f1', sectionId: 's1', repeat: 1 }], warnings: ['수동 음가 검토 필요'], source: 'manual',
};
const patch = { title: null, artist: null, warnings: ['가사 확인 필요'], measures: [{ measureId: 'm1', lyrics: ['주', '를', '찬', '양'], chords: [{ beat: 1, symbol: 'Am' }] }] };
function handler() { assert.equal(typeof recognition.handleAnnotationRequest, 'function'); return recognition.handleAnnotationRequest; }
function request(scoreValue: unknown = score, customize?: (form: FormData) => void) {
  const form = new FormData();
  form.append('image', new Blob([png], { type: 'image/png' }), 'song.png');
  form.append('score', typeof scoreValue === 'string' ? scoreValue : JSON.stringify(scoreValue));
  customize?.(form);
  return new Request('https://score.test/api/annotate', { method: 'POST', headers: { origin: 'https://score.test' }, body: form });
}
function upstream(value: unknown = patch, cost: unknown = 0.0003) {
  return Response.json({ status: 'completed', model: 'annotation-model', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 150, output_tokens: 50, total_tokens: 200, cost } });
}

test('public configuration exposes the annotation model without credentials or server URL', () => {
  const config = recognition.getPublicConfig(env);
  assert.equal(config.model, 'main-model');
  assert.equal(config.annotationModel, 'annotation-model');
  assert.equal(JSON.stringify(config).includes('test-only-secret'), false);
});

test('annotation endpoint returns patched text while preserving every immutable score value', async () => {
  const original = structuredClone(score);
  const response = await handler()(request(), env, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, 'annotation-model');
    assert.equal(body.text.format.name, 'score_annotations');
    assert.deepEqual(Object.keys(body.text.format.schema.properties).sort(), ['artist', 'measures', 'title', 'warnings']);
    assert.equal(body.text.format.strict, true);
    assert.ok(body.input[0].content[0].text.includes('m1'));
    assert.ok(body.input[0].content[0].text.includes('untrusted'));
    assert.ok(body.input[0].content[0].text.includes('Never concatenate adjacent chord labels'));
    return upstream();
  });
  assert.equal(response.status, 200);
  const result = await response.json() as RecognitionResult;
  assert.equal(result.model, 'annotation-model');
  assert.equal(result.cost, 0.0003);
  assert.deepEqual(result.usage, { inputTokens: 150, outputTokens: 50, totalTokens: 200, cachedTokens: 0 });
  assert.deepEqual(result.score.form, score.form);
  assert.equal(result.score.title, score.title);
  assert.equal(result.score.artist, score.artist);
  assert.deepEqual(result.score.sections[0].measures[0].notes.map(note => ({ ...note, lyric: '' })), score.sections[0].measures[0].notes);
  assert.deepEqual(result.score.sections[0].measures[0].notes.map(note => note.lyric), ['주', '를', '찬', '양']);
  assert.equal(result.score.sections[0].measures[0].chords[0].symbol, 'Am');
  assert.ok(result.score.warnings.includes('수동 음가 검토 필요'));
  assert.deepEqual(score, original);
});

test('annotation schema and prompt branch correctly for compatible schema, JSON Object, and prompt modes', async () => {
  for (const format of ['json_schema', 'json_object', 'prompt']) {
    const response = await handler()(request(), { AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_MODEL: 'fallback-model', AI_OUTPUT_FORMAT: format }, async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, 'fallback-model');
      assert.equal(body.max_tokens, 14000);
      if (format === 'json_schema') assert.deepEqual(Object.keys(body.response_format.json_schema.schema.properties).sort(), ['artist', 'measures', 'title', 'warnings']);
      else assert.ok(body.messages[0].content.includes('measureId'));
      if (format === 'prompt') assert.equal('response_format' in body, false);
      assert.ok(body.messages[1].content[0].text.includes('m1'));
      return Response.json({ model: 'fallback-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(patch) } }] });
    });
    assert.equal(response.status, 200);
  }
});

test('annotation output format overrides the full-recognition format without changing that endpoint', async () => {
  const environment = { AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_MODEL: 'main-model', AI_OUTPUT_FORMAT: 'json_object', AI_ANNOTATION_OUTPUT_FORMAT: 'json_schema' };
  let annotationFormat: unknown;
  const response = await handler()(request(), environment, async (_url, options) => {
    annotationFormat = JSON.parse(String(options?.body)).response_format;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(patch) } }] });
  });
  assert.equal(response.status, 200);
  assert.equal((annotationFormat as { type: string }).type, 'json_schema');
  const full = await recognition.handleRecognitionRequest(request(score, form => form.delete('score')), environment, async (_url, options) => {
    assert.deepEqual(JSON.parse(String(options?.body)).response_format, { type: 'json_object' });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] });
  });
  assert.equal(full.status, 200);
});

test('annotation-specific prompt mode works and invalid annotation formats fail before AI', async () => {
  const environment = { AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_OUTPUT_FORMAT: 'json_schema', AI_ANNOTATION_OUTPUT_FORMAT: 'prompt' };
  const response = await handler()(request(), environment, async (_url, options) => {
    assert.equal('response_format' in JSON.parse(String(options?.body)), false);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(patch) } }] });
  });
  assert.equal(response.status, 200);
  const invalid = await handler()(request(), { ...environment, AI_ANNOTATION_OUTPUT_FORMAT: 'text' }, async () => { assert.fail('invalid annotation format must not call AI'); });
  assert.equal(invalid.status, 503);
  assert.equal((await invalid.json() as { error: { code: string } }).error.code, 'AI_CONFIG_INVALID');
});

test('annotation Flex targets only the proven OpenRouter OpenAI Flex provider', async () => {
  const environment = { AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_MODEL: 'qwen/qwen3.7-flash', AI_ANNOTATION_MODEL: 'openai/gpt-6-sol', AI_ANNOTATION_SERVICE_TIER: 'flex' };
  const response = await handler()(request(), environment, async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, 'openai/gpt-6-sol');
    assert.equal(body.service_tier, 'flex');
    assert.deepEqual(body.provider, { only: ['openai/flex'], allow_fallbacks: false, require_parameters: true });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(patch) } }] });
  });
  assert.equal(response.status, 200);
  const full = await recognition.handleRecognitionRequest(request(score, form => form.delete('score')), environment, async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, 'qwen/qwen3.7-flash');
    assert.equal('service_tier' in body, false);
    assert.deepEqual(body.provider, { require_parameters: true, sort: 'price' });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] });
  });
  assert.equal(full.status, 200);
});

test('blank, default, or absent annotation tiers preserve existing price routing', async () => {
  for (const tier of ['', 'default', undefined]) {
    const response = await handler()(request(), { AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_ANNOTATION_SERVICE_TIER: tier }, async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal('service_tier' in body, false);
      assert.deepEqual(body.provider, { require_parameters: true, sort: 'price' });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(patch) } }] });
    });
    assert.equal(response.status, 200);
  }
});

test('invalid annotation Flex settings never send a client request and do not affect full recognition', async () => {
  const base = { AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_MODEL: 'qwen/qwen3.7-flash', AI_ANNOTATION_MODEL: 'openai/gpt-6-sol', AI_ANNOTATION_SERVICE_TIER: 'flex' };
  for (const environment of [
    { ...base, AI_ANNOTATION_SERVICE_TIER: 'priority' },
    { ...base, AI_ANNOTATION_MODEL: 'qwen/qwen3.8-flash' },
    { ...base, AI_ANNOTATION_MODEL: 'openai/' },
    { ...base, AI_BASE_URL: 'https://openrouter.ai.lookalike.test/v1' },
    { ...base, AI_PROVIDER: 'openai', AI_BASE_URL: 'https://api.openai.com/v1', AI_ANNOTATION_MODEL: 'openai/gpt-6-sol' },
  ]) {
    const response = await handler()(request(), environment, async () => { assert.fail('invalid annotation tier must not call AI'); });
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_CONFIG_INVALID');
  }
  const full = await recognition.handleRecognitionRequest(request(score, form => form.delete('score')), { ...base, AI_ANNOTATION_SERVICE_TIER: 'invalid-for-annotation' }, async (_url, options) => {
    assert.equal('service_tier' in JSON.parse(String(options?.body)), false);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] });
  });
  assert.equal(full.status, 200);
});

test('annotation rejects malformed, oversized, missing, duplicate, and unexpected score form fields before AI', async () => {
  const cases = [
    request('{bad'),
    request({ ...score, key: 'invalid' }),
    request({ ...score, warnings: ['가'.repeat(22_000)] }),
    request(score, form => form.delete('score')),
    request(score, form => form.append('score', JSON.stringify(score))),
    request(score, form => form.set('score', new Blob(['{}'], { type: 'application/json' }))),
    request(score, form => form.append('model', 'unexpected-model')),
  ];
  for (const req of cases) {
    const response = await handler()(req, env, async () => { assert.fail('invalid input must not call AI'); });
    assert.ok([400, 413].includes(response.status));
  }
  const legacy = await recognition.handleRecognitionRequest(request(), env, async () => { assert.fail('full recognition still accepts image only'); });
  assert.equal(legacy.status, 400);
});

test('annotation rejects AI attempts to rewrite notes or provide partial measures', async () => {
  for (const value of [{ ...patch, notes: [{ pitch: 'B9' }] }, { ...patch, measures: [] }, { ...patch, measures: [{ ...patch.measures[0], lyrics: ['한'] }] }]) {
    const response = await handler()(request(), env, async () => upstream(value));
    assert.equal(response.status, 502);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_INVALID_ANNOTATIONS');
  }
});

test('annotation shares credential and origin safeguards without reading an unconfigured upload', async () => {
  const req = request();
  const response = await handler()(req, {}, async () => { assert.fail('unconfigured must not call AI'); });
  assert.equal(response.status, 503);
  assert.equal(req.bodyUsed, false);
  const other = request(); other.headers.set('origin', 'https://other.test');
  assert.equal((await handler()(other, env, async () => upstream())).status, 403);
});

test('annotation and full recognition share one active request lock and release it after completion', async () => {
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  let release!: (value: Response) => void;
  const pending = handler()(request(), env, () => new Promise<Response>(resolve => { release = resolve; started(); }));
  await start;
  const blocked = await recognition.handleRecognitionRequest(request(), env, async () => upstream());
  assert.equal(blocked.status, 429);
  release(upstream());
  assert.equal((await pending).status, 200);
  assert.equal((await handler()(request(), env, async () => upstream())).status, 200);
});

test('annotation exposes cost only when upstream usage.cost is finite and nonnegative', async () => {
  for (const cost of [-1, null, '0.01']) {
    const response = await handler()(request(), env, async () => upstream(patch, cost));
    assert.equal(response.status, 200);
    assert.equal('cost' in (await response.json() as object), false);
  }
});

test('annotation preserves the shared 90-second AI timeout and then accepts another request', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const pending = handler()(request(), env, (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    started();
  }));
  await start;
  context.mock.timers.tick(90_000);
  const response = await pending;
  context.mock.timers.reset();
  assert.equal(response.status, 504);
  assert.equal((await handler()(request(), env, async () => upstream())).status, 200);
});
