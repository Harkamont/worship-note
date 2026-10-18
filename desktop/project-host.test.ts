import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSampleScore } from '../lib/sample.ts';
import { normalizeProject, MAX_PROJECT_JSON_BYTES } from '../lib/project-io.ts';
import type { SavedProject } from '../lib/project-storage.ts';
import { createProjectHandler } from './project-host.ts';

const origin = 'http://127.0.0.1:3210';
const url = origin + '/api/local-project';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvRoAAAAASUVORK5CYII=';
function project(title = '저장할 찬양'): SavedProject {
  return { score: { ...createSampleScore(), title, source: 'ai' }, originalImage: PNG, originalName: '원본.png', recognition: { model: 'test-model', provider: 'openai-compatible', elapsedMs: 100, usage: null }, updatedAt: '2026-10-18T11:22:33.444Z' };
}
function request(value?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: value === undefined ? 'GET' : 'PUT', headers: { host: '127.0.0.1:3210', ...(value === undefined ? {} : { origin, 'content-type': 'application/json' }), ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
async function setup() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'score-project-')));
  return { directory, current: join(directory, 'projects', 'current.json'), backup: join(directory, 'projects', 'current.backup.json'), handle: createProjectHandler({ directory, environment: { NODE_ENV: 'test' } }), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('missing project loads as null and valid projects round trip through private files', async () => {
  const context = await setup();
  try {
    const initial = await context.handle(request());
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), { desktop: true, project: null });
    const saved = await context.handle(request({ ...project(), ignored: 'do not retain' }));
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as { saved: boolean }).saved, true);
    const loaded = await context.handle(request());
    assert.deepEqual(await loaded.json(), { desktop: true, project: project() });
    assert.deepEqual(JSON.parse(await readFile(context.current, 'utf8')), normalizeProject(project()));
    // Windows reports synthetic mode bits; its ACLs are not POSIX permissions.
    // Keep all read/write and preservation checks on both platforms.
    if (process.platform !== 'win32') {
      assert.equal((await stat(context.directory)).mode & 0o777, 0o700);
      assert.equal((await stat(join(context.directory, 'projects'))).mode & 0o777, 0o700);
      assert.equal((await stat(context.current)).mode & 0o777, 0o600);
    }
    assert.deepEqual(await readdir(join(context.directory, 'projects')), ['current.json']);
  } finally { await context.cleanup(); }
});

test('corrupted and invalid existing files return an error and cannot be overwritten', async () => {
  const context = await setup();
  try {
    await mkdir(join(context.directory, 'projects'));
    for (const contents of ['{broken', JSON.stringify({ ...project(), score: {} })]) {
      await writeFile(context.current, contents);
      assert.equal((await context.handle(request())).status, 503);
      assert.equal((await context.handle(request(project()))).status, 503);
      assert.equal(await readFile(context.current, 'utf8'), contents);
    }
  } finally { await context.cleanup(); }
});

test('malformed JSON and invalid projects preserve the previous valid file', async () => {
  const context = await setup();
  try {
    await context.handle(request(project()));
    const before = await readFile(context.current, 'utf8');
    const malformed = new Request(url, { method: 'PUT', headers: { host: '127.0.0.1:3210', origin, 'content-type': 'application/json' }, body: '{broken' });
    assert.equal((await context.handle(malformed)).status, 400);
    assert.equal((await context.handle(request({ ...project(), originalImage: 'https://example.test/image.png' }))).status, 400);
    assert.equal(await readFile(context.current, 'utf8'), before);
  } finally { await context.cleanup(); }
});

test('oversized streamed requests are bounded even when Content-Length is misleading', async () => {
  const context = await setup();
  try {
    await context.handle(request(project()));
    const before = await readFile(context.current, 'utf8');
    let cancelled = false;
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
    const streamed = new Request(url, { method: 'PUT', headers: { host: '127.0.0.1:3210', origin, 'content-type': 'application/json', 'content-length': '1' }, body, duplex: 'half' } as RequestInit);
    assert.equal((await context.handle(streamed)).status, 413);
    assert.equal(cancelled, true);
    assert.ok(chunks <= 47);
    assert.equal((await context.handle(request(project(), { 'content-length': String(MAX_PROJECT_JSON_BYTES + 1) }))).status, 413);
    assert.equal(await readFile(context.current, 'utf8'), before);
  } finally { await context.cleanup(); }
});

test('host and origin checks prevent other websites from reading or writing projects', async () => {
  const context = await setup();
  try {
    for (const host of ['evil.example', 'localhost:3210', '127.0.0.1:3210.evil.example']) assert.equal((await context.handle(request(undefined, { host }))).status, 403);
    assert.equal((await context.handle(request(undefined, { origin: 'https://evil.example' }))).status, 403);
    for (const address of ['https://127.0.0.1:3210/api/local-project', 'http://localhost:3210/api/local-project', 'http://127.0.0.1:3211/api/local-project']) assert.equal((await context.handle(new Request(address, { headers: { host: '127.0.0.1:3210' } }))).status, 403);
    const invalidHeaders: Record<string, string>[] = [{ origin: '' }, { origin: 'https://evil.example' }, { 'content-type': 'text/plain' }, { 'content-type': 'application/jsonp' }];
    for (const headers of invalidHeaders) assert.equal((await context.handle(request(project(), headers))).status, 403);
    const withoutOrigin = request(project()); withoutOrigin.headers.delete('origin');
    assert.equal((await context.handle(withoutOrigin)).status, 403);
    assert.equal((await context.handle(new Request(url, { method: 'DELETE', headers: { host: '127.0.0.1:3210' } }))).status, 405);
    assert.equal((await context.handle(request(project(), { 'content-type': 'application/json; charset=utf-8' }))).status, 200);
  } finally { await context.cleanup(); }
});

test('configured desktop ports use the same exact host and origin rules', async () => {
  const context = await setup();
  try {
    const handle = createProjectHandler({ directory: context.directory, environment: { NODE_ENV: 'test', CHANYANG_PORT: '3219' } });
    assert.equal((await handle(request())).status, 403);
    const custom = new Request('http://127.0.0.1:3219/api/local-project', { method: 'PUT', headers: { host: '127.0.0.1:3219', origin: 'http://127.0.0.1:3219', 'content-type': 'application/json' }, body: JSON.stringify(project()) });
    assert.equal((await handle(custom)).status, 200);
  } finally { await context.cleanup(); }
});

test('successive and simultaneous saves preserve the preceding valid project as a private backup', async () => {
  const context = await setup();
  try {
    await context.handle(request(project('첫 저장')));
    const responses = await Promise.all([context.handle(request(project('두 번째'))), context.handle(request(project('세 번째')))]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    assert.deepEqual(JSON.parse(await readFile(context.current, 'utf8')), project('세 번째'));
    assert.deepEqual(JSON.parse(await readFile(context.backup, 'utf8')), project('두 번째'));
    if (process.platform !== 'win32') assert.equal((await stat(context.backup)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(join(context.directory, 'projects'))).sort(), ['current.backup.json', 'current.json']);
  } finally { await context.cleanup(); }
});

test('symlink application directories are rejected before reading or saving', async () => {
  const context = await setup();
  const link = context.directory + '-link';
  try {
    await context.handle(request(project()));
    await symlink(context.directory, link, 'dir');
    const handle = createProjectHandler({ directory: link, environment: { NODE_ENV: 'test' } });
    assert.equal((await handle(request())).status, 503);
    assert.equal((await handle(request(project('다른 제목')))).status, 503);
    assert.deepEqual(JSON.parse(await readFile(context.current, 'utf8')), project());
  } finally { await rm(link, { force: true }); await context.cleanup(); }
});

test('symlink project directories are rejected even when their current file is missing', async () => {
  const context = await setup();
  try {
    const elsewhere = join(context.directory, 'elsewhere'); await mkdir(elsewhere);
    await symlink(elsewhere, join(context.directory, 'projects'), 'dir');
    assert.equal((await context.handle(request())).status, 503);
    assert.equal((await context.handle(request(project()))).status, 503);
    assert.deepEqual(await readdir(elsewhere), []);
  } finally { await context.cleanup(); }
});

test('symlink current files and backup files cannot redirect reads or writes', async () => {
  const context = await setup();
  try {
    await mkdir(join(context.directory, 'projects'));
    const elsewhere = join(context.directory, 'elsewhere.json'); const contents = JSON.stringify(project()); await writeFile(elsewhere, contents);
    await symlink(elsewhere, context.current);
    assert.equal((await context.handle(request())).status, 503);
    assert.equal((await context.handle(request(project('새 제목')))).status, 503);
    await rm(context.current); await writeFile(context.current, contents);
    await symlink(elsewhere, context.backup);
    assert.equal((await context.handle(request(project('새 제목')))).status, 503);
    assert.equal(await readFile(context.current, 'utf8'), contents);
    assert.equal(await readFile(elsewhere, 'utf8'), contents);
    assert.deepEqual((await readdir(join(context.directory, 'projects'))).sort(), ['current.backup.json', 'current.json']);
  } finally { await context.cleanup(); }
});
