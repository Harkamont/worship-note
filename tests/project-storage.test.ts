import test from 'node:test';
import assert from 'node:assert/strict';
import type { SavedProject } from '../lib/project-storage.ts';
import { createSampleScore } from '../lib/sample.ts';

function project(title = '기존 작업'): SavedProject {
  return { score: { ...createSampleScore(), title }, originalImage: null, originalName: '', recognition: null, updatedAt: '2026-10-18T00:00:00Z' };
}

/** Only browser IDB events are faked; serialization and validation run unchanged. */
function storage(initial: unknown, openDelays: number[] = [], fetcher: typeof fetch = async () => new Response(null, { status: 404 })) {
  let record = structuredClone(initial);
  let opens = 0;
  let closes = 0;
  let failNextWrite = false;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/local-project');
    return fetcher(input, init);
  };
  const factory = {
    open() {
      const request: Record<string, unknown> = {};
      const delay = openDelays[opens++] ?? 0;
      request.result = {
        close() { closes++; },
        transaction() {
          const tx: Record<string, unknown> = {};
          tx.objectStore = () => ({
            get() {
              const read: Record<string, unknown> = {};
              setTimeout(() => {
                read.result = structuredClone(record);
                (read.onsuccess as (() => void))?.();
                (tx.oncomplete as (() => void))?.();
              }, 0);
              return read;
            },
            put(value: unknown) {
              const clone = structuredClone(value);
              setTimeout(() => {
                if (failNextWrite) { failNextWrite = false; (tx.onerror as (() => void))?.(); }
                else { record = clone; (tx.oncomplete as (() => void))?.(); }
              }, 0);
            },
          });
          return tx;
        },
      };
      setTimeout(() => (request.onsuccess as (() => void))?.(), delay);
      return request;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
  return {
    get record() { return record; }, get opens() { return opens; }, get closes() { return closes; },
    failWrite() { failNextWrite = true; },
    restore() { globalThis.fetch = originalFetch; if (original) Object.defineProperty(globalThis, 'indexedDB', original); else Reflect.deleteProperty(globalThis, 'indexedDB'); },
  };
}

let moduleIndex = 0;
async function api(): Promise<typeof import('../lib/project-storage.ts')> {
  const url = new URL('../lib/project-storage.ts', import.meta.url);
  url.searchParams.set('storage-test', String(moduleIndex++));
  return import(url.href);
}

test('loads old saved projects through normalization and rejects damaged records without replacing them', async () => {
  const { loadProject } = await api();
  const old = project();
  const db = storage({ ...old, unexpected: 'discard' });
  try { assert.deepEqual(await loadProject(), old); assert.equal(db.closes, 1); }
  finally { db.restore(); }
  const damaged = { ...old, reviewWorkspace: { version: 1, sourceXML: '<score-partwise>' } };
  const invalidDB = storage(damaged);
  try {
    await assert.rejects(loadProject());
    assert.deepEqual(invalidDB.record, damaged);
    assert.equal(invalidDB.closes, 1);
  } finally { invalidDB.restore(); }
});

test('rejects invalid saves before opening storage and retains the last valid record', async () => {
  const { saveProject } = await api();
  const old = project();
  const db = storage(old);
  try {
    await assert.rejects(saveProject({ ...project('잘못된 작업'), originalImage: 'https://example.test/image.png' }));
    assert.deepEqual(db.record, old);
    assert.equal(db.opens, 0);
  } finally { db.restore(); }
});

test('serializes concurrent writes so delayed older transactions cannot replace a newer project', async () => {
  const { saveProject } = await api();
  const db = storage(project(), [30, 0]);
  try {
    const first = saveProject(project('첫 번째'));
    const second = saveProject(project('두 번째'));
    await Promise.all([first, second]);
    assert.deepEqual(db.record, project('두 번째'));
    assert.equal(db.closes, 2);
  } finally { db.restore(); }
});

test('a failed storage write preserves old data and does not block later valid saves', async () => {
  const { loadProject, saveProject } = await api();
  const old = project();
  const db = storage(old);
  try {
    db.failWrite();
    await assert.rejects(saveProject(project('실패')));
    assert.deepEqual(db.record, old);
    await saveProject(project('복구'));
    assert.deepEqual(await loadProject(), project('복구'));
    assert.equal(db.closes, 3);
  } finally { db.restore(); }
});

test('takes a validated snapshot before queued saving and strips unexpected runtime data', async () => {
  const { saveProject } = await api();
  const db = storage(project(), [20]);
  try {
    const input = { ...project('저장 시점'), transientFile: 'discard' };
    const saving = saveProject(input);
    input.score.title = '저장 요청 뒤 수정';
    await saving;
    assert.deepEqual(db.record, project('저장 시점'));
  } finally { db.restore(); }
});

test('reports browser fallback only after the desktop endpoint returns 404', async () => {
  const mod = await api();
  assert.equal(typeof mod.getProjectStorageKind, 'function');
  assert.equal(mod.getProjectStorageKind(), 'unknown');
  const db = storage(project());
  try {
    assert.deepEqual(await mod.loadProject(), project());
    assert.equal(mod.getProjectStorageKind(), 'browser');
  } finally { db.restore(); }
});

test('loads and saves validated desktop projects without opening IndexedDB', async () => {
  const mod = await api();
  let disk: unknown = { ...project('기기 파일'), transient: 'discard' };
  const requests: string[] = [];
  const db = storage(project('예전 브라우저 작업'), [], async (_input, init) => {
    requests.push(init?.method ?? 'GET');
    if (init?.method === 'PUT') {
      assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
      disk = JSON.parse(String(init.body));
      return Response.json({ desktop: true, saved: true });
    }
    return Response.json({ desktop: true, project: disk });
  });
  try {
    assert.deepEqual(await mod.loadProject(), project('기기 파일'));
    assert.equal(mod.getProjectStorageKind(), 'device');
    await mod.saveProject(project('수정한 기기 파일'));
    assert.deepEqual(await mod.loadProject(), project('수정한 기기 파일'));
    assert.deepEqual(requests, ['GET', 'PUT', 'GET']);
    assert.equal(db.opens, 0);
    assert.deepEqual(disk, project('수정한 기기 파일'));
  } finally { db.restore(); }
});

test('desktop GET failure or invalid disk data never falls back to browser data or sends PUT', async () => {
  for (const response of [() => new Response(null, { status: 500 }), () => Response.json({ desktop: true, project: { ...project(), score: {} } }), () => Response.json({ desktop: false, project: null })]) {
    const mod = await api();
    let puts = 0;
    const db = storage(project('브라우저 복사본'), [], async (_input, init) => {
      if (init?.method === 'PUT') puts++;
      return response();
    });
    try {
      await assert.rejects(mod.loadProject());
      await assert.rejects(mod.saveProject(project('덮어쓰면 안 되는 초기 작업')));
      assert.equal(puts, 0);
      assert.equal(db.opens, 0);
      assert.deepEqual(db.record, project('브라우저 복사본'));
    } finally { db.restore(); }
  }
});

test('desktop empty storage reads legacy browser data once and then saves migration to the device', async () => {
  const mod = await api();
  let disk: unknown = null;
  const db = storage(project('이전 작업'), [], async (_input, init) => {
    if (init?.method === 'PUT') { disk = JSON.parse(String(init.body)); return Response.json({ desktop: true, saved: true }); }
    return Response.json({ desktop: true, project: disk });
  });
  try {
    assert.deepEqual(await mod.loadProject(), project('이전 작업'));
    assert.deepEqual(await mod.loadProject(), project('이전 작업'));
    assert.equal(db.opens, 1);
    assert.equal(mod.getProjectStorageKind(), 'device');
    await mod.saveProject(project('이전 작업'));
    assert.deepEqual(disk, project('이전 작업'));
    assert.deepEqual(await mod.loadProject(), project('이전 작업'));
    assert.equal(db.opens, 1);
  } finally { db.restore(); }
});

test('damaged legacy browser work blocks migration rather than overwriting either saved copy', async () => {
  const mod = await api();
  const damaged = { ...project('손상된 이전 작업'), score: {} };
  let puts = 0;
  const db = storage(damaged, [], async (_input, init) => {
    if (init?.method === 'PUT') puts++;
    return Response.json({ desktop: true, project: null });
  });
  try {
    await assert.rejects(mod.loadProject());
    await assert.rejects(mod.saveProject(project('초기 작업')));
    assert.equal(puts, 0);
    assert.deepEqual(db.record, damaged);
  } finally { db.restore(); }
});

test('a failed device PUT preserves disk data, never falls back, and later queued saves recover', async () => {
  const mod = await api();
  let disk: unknown = project('기기 원본');
  let writes = 0;
  const db = storage(project('브라우저 원본'), [], async (_input, init) => {
    if (init?.method === 'PUT') {
      if (++writes === 1) return new Response(null, { status: 500 });
      disk = JSON.parse(String(init.body));
      return Response.json({ desktop: true, saved: true });
    }
    return Response.json({ desktop: true, project: disk });
  });
  try {
    await mod.loadProject();
    await assert.rejects(mod.saveProject(project('실패한 수정')));
    assert.deepEqual(disk, project('기기 원본'));
    const first = mod.saveProject(project('첫 수정'));
    const second = mod.saveProject(project('최종 수정'));
    await Promise.all([first, second]);
    assert.deepEqual(disk, project('최종 수정'));
    assert.equal(db.opens, 0);
    assert.deepEqual(db.record, project('브라우저 원본'));
  } finally { db.restore(); }
});

test('saving before load discovers and validates desktop storage before writing', async () => {
  const mod = await api();
  const calls: string[] = [];
  const db = storage(null, [], async (_input, init) => {
    calls.push(init?.method ?? 'GET');
    return init?.method === 'PUT' ? Response.json({ desktop: true, saved: true }) : Response.json({ desktop: true, project: project('기기 원본') });
  });
  try {
    await mod.saveProject(project('새 작업'));
    assert.deepEqual(calls, ['GET', 'PUT']);
    assert.equal(db.opens, 0);
  } finally { db.restore(); }
});

test('a known device backend never silently changes to IndexedDB after the endpoint disappears', async () => {
  const mod = await api();
  let available = true;
  const db = storage(project('브라우저 원본'), [], async () => available ? Response.json({ desktop: true, project: project('기기 원본') }) : new Response(null, { status: 404 }));
  try {
    await mod.loadProject();
    available = false;
    await assert.rejects(mod.loadProject());
    await assert.rejects(mod.saveProject(project('초기 작업')));
    assert.equal(mod.getProjectStorageKind(), 'device');
    assert.equal(db.opens, 0);
  } finally { db.restore(); }
});
