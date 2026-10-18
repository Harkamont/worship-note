import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecognitionResult, Score } from '../lib/score-types.ts';

const api = await import('../lib/recognition.ts').catch(() => null);
const env = { OPENAI_API_KEY: 'test-only-secret' };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
const score: Score = {
  version: 1, title: '테스트 찬양', artist: '', key: 'C', timeSignature: '4/4', tempo: 80,
  sections: [{ id: 's1', label: 'Verse 1', type: 'verse', measures: [{ id: 'm1',
    notes: ['C4', 'D4', 'E4', 'F4'].map((pitch, i) => ({ id: `n${i}`, pitch, duration: 'q', dots: 0, lyric: ['주', '를', '찬', '양'][i], tie: false })),
    chords: [{ id: 'c1', beat: 1, symbol: 'C' }],
  }] }], form: [{ id: 'f1', sectionId: 's1', repeat: 1 }], warnings: [], source: 'sample',
};
function request(bytes = png, mime = 'image/png', extra?: [string, string]) {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), 'song.png');
  if (extra) form.append(...extra);
  return new Request('https://score.test/api/recognize', { method: 'POST', headers: { origin: 'https://score.test' }, body: form });
}
function upstream(data: unknown = score) {
  return Response.json({ status: 'completed', model: 'gpt-6-luna', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }], usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300, input_tokens_details: { cached_tokens: 10 } } });
}
function moduleApi() { assert.ok(api, 'recognition module must exist'); return api; }

test('public configuration exposes no credentials or custom endpoint', () => {
  const config = moduleApi().getPublicConfig({ ...env, AI_BASE_URL: 'https://gateway.example/v1' });
  assert.deepEqual(config, { configured: true, provider: 'openai', model: 'gpt-6-luna', annotationModel: 'gpt-6-luna', musicxmlModel: 'gpt-6-luna', musicxmlAnnotationModel: 'gpt-6-luna', protocol: 'responses' });
  assert.equal(JSON.stringify(config).includes('test-only-secret'), false);
  assert.equal(moduleApi().getPublicConfig({}).configured, false);
});

test('missing key returns 503 without reading the image or calling AI', async () => {
  const req = request();
  let called = false;
  const response = await moduleApi().handleRecognitionRequest(req, {}, async () => { called = true; return upstream(); });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_NOT_CONFIGURED');
  assert.equal(req.bodyUsed, false);
  assert.equal(called, false);
});

test('compatible providers require their own AI_API_KEY and never reuse the OpenAI key', async () => {
  const thirdParty = { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'https://vision.example/v1', ...env };
  assert.equal(moduleApi().getPublicConfig(thirdParty).configured, false);
  const req = request();
  const response = await moduleApi().handleRecognitionRequest(req, thirdParty, async () => { assert.fail('must not send an OpenAI key to another provider'); });
  assert.equal(response.status, 503);
  assert.equal(req.bodyUsed, false);
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_NOT_CONFIGURED');
});

test('rejects cross-origin and absent-origin requests before AI', async () => {
  for (const origin of ['https://other.test', null]) {
    const req = request();
    if (origin) req.headers.set('origin', origin); else req.headers.delete('origin');
    const response = await moduleApi().handleRecognitionRequest(req, env, async () => { assert.fail('must not call AI'); });
    assert.equal(response.status, 403);
  }
});

test('rejects spoofed file signatures and non-image MIME types', async () => {
  for (const req of [request(new TextEncoder().encode('<script>bad</script>')), request(png, 'application/pdf')]) {
    const response = await moduleApi().handleRecognitionRequest(req, env, async () => { assert.fail('must not call AI'); });
    assert.equal(response.status, 415);
  }
});

test('enforces 10 MiB image limit and rejects extra model/endpoint fields', async () => {
  for (const req of [request(new Uint8Array(10 * 1024 * 1024 + 1)), request(png, 'image/png', ['model', 'expensive-model'])]) {
    const response = await moduleApi().handleRecognitionRequest(req, env, async () => { assert.fail('must not call AI'); });
    assert.ok([400, 413].includes(response.status));
  }
});

test('Responses provider sends actual image, strict score schema, configured model, and no browser-controlled options', async () => {
  const response = await moduleApi().handleRecognitionRequest(request(), env, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-only-secret');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, 'gpt-6-luna');
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 14000);
    assert.ok(body.input[0].content[0].text.includes('Never concatenate adjacent chord labels'));
    assert.match(body.input[0].content[1].image_url, /^data:image\/png;base64,iVBOR/);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema.required.sort(), Object.keys(score).sort());
    assert.ok(options?.signal);
    return upstream();
  });
  assert.equal(response.status, 200);
  const result = await response.json() as RecognitionResult;
  assert.equal(result.score.source, 'ai');
  assert.equal(result.score.sections[0].measures[0].notes.length, 4);
  assert.deepEqual(result.usage, { inputTokens: 200, outputTokens: 100, totalTokens: 300, cachedTokens: 10 });
  assert.ok(result.elapsedMs >= 0);
  assert.equal(result.model, 'gpt-6-luna');
});

test('strict JSON schema forbids undeclared keys in every nested object', () => {
  const schema = moduleApi().SCORE_JSON_SCHEMA;
  function inspect(node: Record<string, unknown>) {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...(node.required as string[])].sort(), Object.keys(node.properties as object).sort());
    }
    for (const child of Object.values(node.properties as object ?? {})) inspect(child as Record<string, unknown>);
    if (node.items) inspect(node.items as Record<string, unknown>);
  }
  inspect(schema);
});

test('compatible provider uses Chat Completions and normalizes its usage', async () => {
  const response = await moduleApi().handleRecognitionRequest(request(), { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'https://vision.example/api/v1/', AI_MODEL: 'vision-small', AI_API_KEY: 'compatible-secret' }, async (url, options) => {
    assert.equal(url, 'https://vision.example/api/v1/chat/completions');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, 'vision-small');
    assert.equal(body.messages[1].content[1].type, 'image_url');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.ok(body.messages[0].content.includes(JSON.stringify(moduleApi().SCORE_JSON_SCHEMA)));
    assert.equal(body.max_tokens, 14000);
    assert.equal('max_completion_tokens' in body, false);
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer compatible-secret');
    return Response.json({ model: 'vision-small-2026', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }], usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 } });
  });
  assert.equal(response.status, 200);
  const result = await response.json() as RecognitionResult;
  assert.equal(result.provider, 'openai-compatible');
  assert.equal(result.model, 'vision-small-2026');
  assert.deepEqual(result.usage, { inputTokens: 50, outputTokens: 30, totalTokens: 80, cachedTokens: 0 });
});

test('compatible providers can explicitly request strict JSON Schema when their model supports it', async () => {
  let sent: Record<string, unknown> = {};
  const response = await moduleApi().handleRecognitionRequest(request(), {
    AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_OUTPUT_FORMAT: 'json_schema',
  }, async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(sent.response_format, { type: 'json_schema', json_schema: { name: 'recognized_score', strict: true, schema: moduleApi().SCORE_JSON_SCHEMA } });
});

test('compatible prompt mode omits response_format and includes the full schema with JSON-only instructions', async () => {
  let sent: Record<string, unknown> = {};
  const response = await moduleApi().handleRecognitionRequest(request(), {
    AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_OUTPUT_FORMAT: 'prompt',
  }, async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] });
  });
  assert.equal(response.status, 200);
  assert.equal('response_format' in sent, false);
  const messages = sent.messages as { role: string; content: string }[];
  assert.ok(messages[0].content.includes(JSON.stringify(moduleApi().SCORE_JSON_SCHEMA)));
  assert.ok(messages[0].content.includes('Return only the schema-conforming JSON'));
  assert.equal(sent.max_tokens, 14000);
});

test('OpenAI Responses keeps strict schema even when the compatible JSON Object option is configured', async () => {
  for (const outputFormat of ['json_object', 'prompt']) {
    let sent: Record<string, unknown> = {};
    const response = await moduleApi().handleRecognitionRequest(request(), { ...env, AI_OUTPUT_FORMAT: outputFormat }, async (_url, options) => {
      sent = JSON.parse(String(options?.body));
      return upstream();
    });
    assert.equal(response.status, 200);
    assert.deepEqual(sent.text, { format: { type: 'json_schema', name: 'recognized_score', strict: true, schema: moduleApi().SCORE_JSON_SCHEMA } });
    assert.equal(sent.max_output_tokens, 14000);
  }
});

test('invalid output format configuration is rejected before an upstream call', async () => {
  const response = await moduleApi().handleRecognitionRequest(request(), { AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_OUTPUT_FORMAT: 'text' }, async () => { assert.fail('invalid configuration must not call AI'); });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_CONFIG_INVALID');
});

test('OpenRouter supports an explicit reasoning toggle and chooses providers by price and parameter support', async () => {
  for (const enabled of ['true', 'false']) {
    let sent: Record<string, unknown> = {};
    const response = await moduleApi().handleRecognitionRequest(request(), {
      AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_REASONING_ENABLED: enabled,
    }, async (_url, options) => {
      sent = JSON.parse(String(options?.body));
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] });
    });
    assert.equal(response.status, 200);
    assert.deepEqual(sent.reasoning, { enabled: enabled === 'true' });
    assert.deepEqual(sent.provider, { require_parameters: true, sort: 'price' });
  }
});

test('OpenRouter omits the reasoning field when its optional toggle is unset', async () => {
  let sent: Record<string, unknown> = {};
  const response = await moduleApi().handleRecognitionRequest(request(), {
    AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_BASE_URL: 'https://openrouter.ai/api/v1',
  }, async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] });
  });
  assert.equal(response.status, 200);
  assert.equal('reasoning' in sent, false);
  assert.deepEqual(sent.provider, { require_parameters: true, sort: 'price' });
});

test('OpenRouter-only reasoning and routing fields are never sent to other providers or lookalike hosts', async () => {
  for (const baseUrl of ['https://api.z.ai/api/paas/v4', 'https://vision.example/v1', 'https://openrouter.ai.lookalike.test/v1']) {
    let sent: Record<string, unknown> = {};
    const response = await moduleApi().handleRecognitionRequest(request(), {
      AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_BASE_URL: baseUrl, AI_REASONING_ENABLED: 'false',
    }, async (_url, options) => {
      sent = JSON.parse(String(options?.body));
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] });
    });
    assert.equal(response.status, 200);
    assert.equal('reasoning' in sent, false);
    assert.equal('provider' in sent, false);
  }
  let sent: Record<string, unknown> = {};
  const response = await moduleApi().handleRecognitionRequest(request(), { ...env, AI_REASONING_ENABLED: 'false' }, async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return upstream();
  });
  assert.equal(response.status, 200);
  assert.deepEqual(sent.reasoning, { effort: 'low' });
  assert.equal('provider' in sent, false);
});

test('invalid reasoning toggle configuration fails before an upstream call', async () => {
  const response = await moduleApi().handleRecognitionRequest(request(), { ...env, AI_REASONING_ENABLED: 'yes' }, async () => { assert.fail('invalid reasoning configuration must not call AI'); });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_CONFIG_INVALID');
});

test('distinguishes refusal, truncation, invalid JSON, and invalid musical data', async () => {
  const cases = [
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, 'AI_REFUSED'],
    [{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }, 'AI_TRUNCATED'],
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{bad' }] }] }, 'AI_INVALID_JSON'],
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...score, key: 'bogus' }) }] }] }, 'AI_INVALID_SCORE'],
  ] as const;
  for (const [data, expected] of cases) {
    const response = await moduleApi().handleRecognitionRequest(request(), env, async () => Response.json(data));
    assert.equal(response.status, 502);
    assert.equal((await response.json() as { error: { code: string } }).error.code, expected);
  }
});

test('upstream error and network details never expose credentials or raw content', async () => {
  for (const fetcher of [async () => Response.json({ error: { message: 'test-only-secret https://secret.example private raw error' } }, { status: 401 }), async () => { throw new Error('test-only-secret private raw error'); }]) {
    const response = await moduleApi().handleRecognitionRequest(request(), env, fetcher);
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.equal(text.includes('test-only-secret'), false);
    assert.equal(text.includes('private raw error'), false);
  }
});

test('maps allowlisted credit errors to AI_QUOTA_EXCEEDED without exposing upstream messages', async () => {
  for (const error of [
    { code: 'credit_balance_exhausted', type: 'insufficient_quota', message: 'test-only-secret private billing details' },
    { code: 'insufficient_quota', message: 'private billing details' },
    { type: 'insufficient_quota', message: 'private billing details' },
  ]) {
    const response = await moduleApi().handleRecognitionRequest(request(), env, async () => Response.json({ error }, { status: 429 }));
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: {
      code: 'AI_QUOTA_EXCEEDED',
      message: 'API 크레딧이 소진되었거나 프로젝트 사용 한도에 도달했습니다. 앱 운영자의 API 결제·한도를 확인해 주세요.',
    } });
  }
});

test('keeps ordinary, malformed, and oversized 429 errors as AI_RATE_LIMITED', async () => {
  for (const body of [
    JSON.stringify({ error: { code: 'rate_limit_exceeded', type: 'requests', message: 'credit_balance_exhausted insufficient_quota test-only-secret' } }),
    'not JSON test-only-secret',
    JSON.stringify({ error: { code: 'credit_balance_exhausted', message: 'x'.repeat(20 * 1024) } }),
  ]) {
    const response = await moduleApi().handleRecognitionRequest(request(), env, async () => new Response(body, { status: 429 }));
    assert.equal(response.status, 429);
    const data = await response.json() as { error: { code: string; message: string } };
    assert.equal(data.error.code, 'AI_RATE_LIMITED');
    assert.equal(data.error.message.includes('test-only-secret'), false);
  }
});

test('Z.ai overloaded code 1305 reports a temporary service problem without exposing raw errors', async () => {
  for (const code of ['1305', 1305]) {
    const response = await moduleApi().handleRecognitionRequest(request(), {
      AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_BASE_URL: 'https://api.z.ai/api/paas/v4', AI_OUTPUT_FORMAT: 'prompt',
    }, async () => Response.json({ error: { code, message: 'provider-only-secret private upstream details' } }, { status: 429 }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'AI_SERVICE_BUSY', message: 'AI 서버가 일시적으로 붐빕니다. 잠시 후 다시 시도해 주세요.' } });
  }
});

test('Z.ai insufficient balance code 1113 uses the existing quota explanation', async () => {
  for (const code of ['1113', 1113]) {
    const response = await moduleApi().handleRecognitionRequest(request(), {
      AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_BASE_URL: 'https://api.z.ai/api/paas/v4',
    }, async () => Response.json({ error: { code } }, { status: 429 }));
    assert.equal(response.status, 429);
    const data = await response.json() as { error: { code: string; message: string } };
    assert.equal(data.error.code, 'AI_QUOTA_EXCEEDED');
    assert.match(data.error.message, /크레딧/);
  }
});

test('numeric Z.ai error codes are not interpreted for other or lookalike hosts', async () => {
  for (const baseUrl of ['https://vision.example/v1', 'https://api.z.ai.lookalike.test/v1']) {
    for (const code of ['1305', '1113']) {
      const response = await moduleApi().handleRecognitionRequest(request(), {
        AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'provider-only-secret', AI_BASE_URL: baseUrl,
      }, async () => Response.json({ error: { code } }, { status: 429 }));
      assert.equal(response.status, 429);
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_RATE_LIMITED');
    }
  }
});

test('preserves the timeout while reading an upstream 429 error body', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const pending = moduleApi().handleRecognitionRequest(request(), env, async (_url, options) => {
    return new Response(new ReadableStream({ start(controller) {
      options?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      started();
    } }), { status: 429 });
  });
  await start;
  context.mock.timers.tick(90_000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_TIMEOUT');
  context.mock.timers.reset();
});

test('uses Workers-compatible manual redirects so credentials are not forwarded to redirected hosts', async () => {
  let redirectMode: RequestRedirect | undefined;
  let calls = 0;
  const response = await moduleApi().handleRecognitionRequest(request(), env, async (_url, options) => {
    calls += 1;
    redirectMode = options?.redirect;
    return new Response(null, { status: 302, headers: { location: 'https://untrusted.example' } });
  });
  assert.equal(redirectMode, 'manual');
  assert.equal(calls, 1);
  assert.equal(response.status, 502);
});

test('model changes do not send unsupported reasoning options to non-reasoning models', async () => {
  let sent: Record<string, unknown> = {};
  await moduleApi().handleRecognitionRequest(request(), { ...env, AI_MODEL: 'gpt-4.1-mini' }, async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return upstream();
  });
  assert.equal(sent.model, 'gpt-4.1-mini');
  assert.equal('reasoning' in sent, false);
});

test('90-second timeout aborts the upstream request and releases the active request slot', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const pending = moduleApi().handleRecognitionRequest(request(), env, (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    started();
  }));
  await start;
  context.mock.timers.tick(90_000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_TIMEOUT');
  context.mock.timers.reset();
});

test('timeout while reading a stalled response also returns AI_TIMEOUT', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const pending = moduleApi().handleRecognitionRequest(request(), env, async (_url, options) => {
    return new Response(new ReadableStream({ start(controller) {
      options?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      started();
    } }));
  });
  await start;
  context.mock.timers.tick(90_000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'AI_TIMEOUT');
  context.mock.timers.reset();
});

test('one active request limit is released after completion', async () => {
  let release!: (value: Response) => void;
  const first = moduleApi().handleRecognitionRequest(request(), env, () => new Promise<Response>(resolve => { release = resolve; }));
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  const second = await moduleApi().handleRecognitionRequest(request(), env, async () => upstream());
  assert.equal(second.status, 429);
  release(upstream());
  assert.equal((await first).status, 200);
  assert.equal((await moduleApi().handleRecognitionRequest(request(), env, async () => upstream())).status, 200);
});

test('stalled uploads expire after 30 seconds even when stream cancellation never completes', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelCalled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { cancelCalled = true; return new Promise(() => {}); },
  });
  const req = new Request('https://score.test/api/recognize', {
    method: 'POST', headers: { origin: 'https://score.test', 'content-type': 'multipart/form-data; boundary=stalled' }, body: stream, duplex: 'half',
  } as RequestInit);
  const pending = moduleApi().handleRecognitionRequest(req, env, async () => { assert.fail('AI must not receive an unfinished upload'); });
  try {
    context.mock.timers.tick(30_000);
    const response = await Promise.race([pending, new Promise<null>(resolve => setImmediate(() => resolve(null)))]);
    assert.ok(response, 'upload timeout must settle without awaiting reader.cancel');
    assert.equal(response.status, 408);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'UPLOAD_TIMEOUT');
    assert.equal(cancelCalled, true);
    assert.equal((await moduleApi().handleRecognitionRequest(request(), env, async () => upstream())).status, 200);
  } finally {
    context.mock.timers.reset();
    controller.error(new Error('test cleanup'));
    await pending;
  }
});

test('client abort ends a stalled upload and releases its active request slot immediately', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { return new Promise(() => {}); },
  });
  const req = new Request('https://score.test/api/recognize', {
    method: 'POST', headers: { origin: 'https://score.test', 'content-type': 'multipart/form-data; boundary=stalled' }, body: stream, signal: abort.signal, duplex: 'half',
  } as RequestInit);
  const pending = moduleApi().handleRecognitionRequest(req, env, async () => { assert.fail('AI must not receive an aborted upload'); });
  try {
    abort.abort();
    const response = await Promise.race([pending, new Promise<null>(resolve => setImmediate(() => resolve(null)))]);
    assert.ok(response, 'client abort must settle without awaiting reader.cancel');
    assert.equal(response.status, 499);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'UPLOAD_ABORTED');
    assert.equal((await moduleApi().handleRecognitionRequest(request(), env, async () => upstream())).status, 200);
  } finally {
    controller.error(new Error('test cleanup'));
    await pending;
  }
});

test('oversized upload returns 413 without waiting for a stalled stream cancellation', async () => {
  let finishCancel!: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 64 * 1024 + 1)); },
    cancel() { return new Promise<void>(resolve => { finishCancel = resolve; }); },
  });
  const req = new Request('https://score.test/api/recognize', {
    method: 'POST', headers: { origin: 'https://score.test', 'content-type': 'multipart/form-data; boundary=oversized' }, body: stream, duplex: 'half',
  } as RequestInit);
  const pending = moduleApi().handleRecognitionRequest(req, env, async () => { assert.fail('AI must not receive an oversized upload'); });
  try {
    const response = await Promise.race([pending, new Promise<null>(resolve => setImmediate(() => resolve(null)))]);
    assert.ok(response, 'size rejection must settle without awaiting reader.cancel');
    assert.equal(response.status, 413);
    assert.equal((await moduleApi().handleRecognitionRequest(request(), env, async () => upstream())).status, 200);
  } finally { finishCancel?.(); await pending; }
});
