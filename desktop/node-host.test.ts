import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { Agent, createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string;
let child: ChildProcess;
let origin: string;
let output = '';
type RequestState = { aborted: boolean; completed: boolean; inheritedAborted?: boolean; explicitAborted?: boolean };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function state(id: string): Promise<RequestState | null> {
  const response = await fetch(`${origin}/state?id=${id}`);
  return response.json();
}

async function waitForState(id: string, predicate = (value: RequestState) => Boolean(value), attempts = 100) {
  let value;
  for (let attempt = 0; attempt < attempts; attempt++) {
    value = await state(id);
    if (value && predicate(value)) return value;
    await pause(10);
  }
  return value;
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'desktop-host-http-'));
  const app = join(directory, 'app');
  await mkdir(join(app, 'dist/server'), { recursive: true });
  await mkdir(join(app, 'dist/client'), { recursive: true });
  await writeFile(join(app, 'package.json'), '{"type":"module"}\n');
  await symlink(resolve('node_modules'), join(app, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  // This handler runs behind the real production Node-to-Web Request adapter.
  await writeFile(join(app, 'dist/server/index.js'), String.raw`
const states = new Map();
export default async function handler(request) {
  const url = new URL(request.url), id = url.searchParams.get('id');
  if (url.pathname === '/state') return Response.json(states.get(id) ?? null);
  const value = { aborted: request.signal.aborted, completed: false };
  request.signal.addEventListener('abort', () => { value.aborted = true; }, { once: true });
  if (url.pathname === '/hold') {
    await request.arrayBuffer();
    const inherited = new Request(new Request(request.url, { signal: request.signal }));
    const explicit = new Request(request.url, { signal: new AbortController().signal });
    inherited.signal.addEventListener('abort', () => { value.inheritedAborted = true; }, { once: true });
    explicit.signal.addEventListener('abort', () => { value.explicitAborted = true; }, { once: true });
    states.set(id, value);
    await new Promise(resolve => {
      const timer = setTimeout(() => { value.completed = true; resolve(); }, 1000);
      request.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    return new Response('done');
  }
  if (url.pathname === '/stream') {
    states.set(id, value);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('first'));
      setTimeout(() => { controller.enqueue(new TextEncoder().encode('second')); value.completed = true; controller.close(); }, 30);
    } }));
  }
  if (url.pathname === '/echo') {
    const text = await request.text();
    value.completed = true;
    states.set(id, value);
    return new Response(text);
  }
  if (url.pathname === '/explicit-signal') {
    const controller = new AbortController();
    const nested = new Request(request, { signal: controller.signal });
    const inherited = new Request(new Request(request.url, { signal: controller.signal }));
    controller.abort();
    return Response.json({ aborted: nested.signal.aborted, inheritedAborted: inherited.signal.aborted, native: nested instanceof Request, samePrototype: Object.getPrototypeOf(nested) === Request.prototype });
  }
  if (url.pathname === '/detached') {
    setTimeout(() => {
      const delayed = new Request(request.url);
      states.set(id, { aborted: delayed.signal.aborted, completed: true });
    }, 30);
    return new Response('complete');
  }
  if (url.pathname === '/request-init') {
    // App Router dispatch passes an existing Request as the init dictionary.
    const forwarded = new Request(new URL(request.url), request);
    return Response.json({ method: forwarded.method, contentType: forwarded.headers.get('content-type'), marker: forwarded.headers.get('x-request-marker'), duplex: forwarded.duplex, body: await forwarded.text() });
  }
  if (url.pathname === '/inherited-init') {
    const prototype = {
      get method() { return this.selectedMethod; },
      get headers() { return { 'x-inherited': this.marker }; },
      get body() { return this.payload; },
      get duplex() { return 'half'; },
    };
    const init = Object.assign(Object.create(prototype), { selectedMethod: 'POST', marker: 'kept', payload: 'inherited body' });
    const forwarded = new Request(request.url, init);
    return Response.json({ method: forwarded.method, marker: forwarded.headers.get('x-inherited'), body: await forwarded.text() });
  }
  if (url.pathname === '/init-semantics') {
    const controller = new AbortController();
    const frozen = new Request(request.url, Object.freeze({ method: 'POST', body: 'frozen body', signal: controller.signal }));
    let reads = 0;
    new Request(request.url, { get signal() { reads++; return controller.signal; } });
    const rejects = value => { try { new Request(request.url, value); return false; } catch (error) { return error instanceof TypeError; } };
    const invalidInitializers = [false, 0, '', 42].map(rejects);
    const invalidSignals = [false, 0, ''].map(signal => rejects({ signal }));
    const emptyInitializers = [null, undefined].map(init => new Request(request.url, init).method);
    controller.abort();
    return Response.json({ frozenMethod: frozen.method, frozenBody: await frozen.text(), frozenAborted: frozen.signal.aborted, reads, invalidInitializers, invalidSignals, emptyInitializers });
  }
  return new Response('missing', { status: 404 });
}
`);
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['desktop/node-host.mjs', app], {
    cwd: resolve('.'), env: { ...process.env, CHANYANG_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', chunk => { output += chunk; });
  child.stderr?.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin + '/state')).ok) return; } catch { /* Host is still starting. */ }
    if (child.exitCode !== null) break;
    await pause(20);
  }
  throw new Error(`Desktop test host did not start: ${output}`);
});

after(async () => {
  if (child && child.exitCode === null) {
    const closed = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    await closed;
    clearTimeout(timer);
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('desktop HTTP disconnect aborts work after the upload body has completed', async () => {
  const controller = new AbortController();
  const response = fetch(origin + '/hold?id=cancel', { method: 'POST', body: 'complete image bytes', signal: controller.signal })
    .catch(error => error as Error);
  assert.ok(await waitForState('cancel'), 'the complete upload must reach the handler before cancellation');
  controller.abort();
  const result = await response;
  assert.ok(result instanceof Error && result.name === 'AbortError');
  const cancelled = await waitForState('cancel', value => value.aborted, 30);
  assert.equal(cancelled?.aborted, true, 'client disconnect must abort the Web Request and its downstream work');
  assert.equal(cancelled?.inheritedAborted, true, 'cloned requests must inherit the transport signal');
  assert.equal(cancelled?.explicitAborted, true, 'an explicit child signal must also retain transport cancellation');
  assert.equal(cancelled?.completed, false);
});

test('desktop cancellation does not abort another in-flight HTTP request', async () => {
  const first = new AbortController();
  const second = new AbortController();
  const firstResponse = fetch(origin + '/hold?id=isolated-one', { method: 'POST', body: 'one', signal: first.signal }).catch(error => error as Error);
  const secondResponse = fetch(origin + '/hold?id=isolated-two', { method: 'POST', body: 'two', signal: second.signal }).catch(error => error as Error);
  assert.ok(await waitForState('isolated-one'));
  assert.ok(await waitForState('isolated-two'));
  first.abort();
  await firstResponse;
  assert.equal((await waitForState('isolated-one', value => value.aborted, 30))?.aborted, true);
  assert.equal((await state('isolated-two'))?.aborted, false);
  second.abort();
  await secondResponse;
  assert.equal((await waitForState('isolated-two', value => value.aborted, 30))?.aborted, true);
});

test('desktop sends a normal streamed response without aborting its request', async () => {
  const response = await fetch(origin + '/stream?id=stream');
  assert.equal(await response.text(), 'firstsecond');
  await pause(20);
  assert.deepEqual(await state('stream'), { aborted: false, completed: true });
});

test('desktop normal body completion preserves keep-alive requests and explicit abort signals', async () => {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  const echo = (id: string) => new Promise<{ body: string; port: number | undefined }>((resolve, reject) => {
    const request = httpRequest(`${origin}/echo?id=${id}`, { method: 'POST', agent }, response => {
      const port = response.socket?.localPort;
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.once('end', () => resolve({ body, port }));
      response.once('error', reject);
    });
    request.once('error', reject);
    request.end(id);
  });
  try {
    const first = await echo('keepalive-one');
    const second = await echo('keepalive-two');
    assert.equal(first.body, 'keepalive-one');
    assert.equal(second.body, 'keepalive-two');
    assert.equal(first.port, second.port, 'the second request must reuse the socket');
    assert.deepEqual(await state('keepalive-one'), { aborted: false, completed: true });
    assert.deepEqual(await state('keepalive-two'), { aborted: false, completed: true });
    const explicit = await fetch(origin + '/explicit-signal');
    assert.deepEqual(await explicit.json(), { aborted: true, inheritedAborted: true, native: true, samePrototype: true });
  } finally { agent.destroy(); }
});

test('desktop tasks scheduled after a normal response retain a live signal', async () => {
  const response = await fetch(origin + '/detached?id=detached');
  assert.equal(await response.text(), 'complete');
  assert.deepEqual(await waitForState('detached'), { aborted: false, completed: true });
});

test('desktop preserves the existing Request used as App Router RequestInit', async () => {
  const response = await fetch(origin + '/request-init', {
    method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test', 'x-request-marker': 'preserved' }, body: 'complete image bytes',
  });
  assert.deepEqual(await response.json(), { method: 'POST', contentType: 'multipart/form-data; boundary=test', marker: 'preserved', duplex: 'half', body: 'complete image bytes' });
});

test('desktop preserves inherited RequestInit getters and their receiver', async () => {
  const response = await fetch(origin + '/inherited-init');
  assert.deepEqual(await response.json(), { method: 'POST', marker: 'kept', body: 'inherited body' });
});

test('desktop preserves frozen dictionaries, single getter reads and native init validation', async () => {
  const response = await fetch(origin + '/init-semantics');
  assert.deepEqual(await response.json(), {
    frozenMethod: 'POST', frozenBody: 'frozen body', frozenAborted: true, reads: 1,
    invalidInitializers: [true, true, true, true], invalidSignals: [true, true, true], emptyInitializers: ['GET', 'GET'],
  });
});
