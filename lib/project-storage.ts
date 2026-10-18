import type { Score, RecognitionResult } from './score-types.ts';
import type { ReviewWorkspace } from './review-workspace.ts';
import { MAX_PROJECT_JSON_BYTES, normalizeProject } from './project-io.ts';
export interface SavedProject { score: Score; originalImage: string | null; originalName: string; recognition: Omit<RecognitionResult, 'score'> | null; updatedAt: string; reviewWorkspace?: ReviewWorkspace; }
export type ProjectStorageKind = 'device' | 'browser' | 'unknown';
let storageKind: ProjectStorageKind = 'unknown';
let backendReady = false;
let loadFailed = false;
let legacyMigration: Promise<SavedProject | null> | null = null;
let pendingWrites: Promise<void> = Promise.resolve();
export function getProjectStorageKind(): ProjectStorageKind { return storageKind; }

function storageError(): Error { return new Error('이 기기의 저장된 작업을 읽거나 저장하지 못했습니다. 기존 파일은 보존됩니다.'); }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
async function responseJSON(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw storageError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw storageError();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw storageError(); }
  } finally {
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A failed read may still be settling. */ }
  }
}

async function readBackend(readBrowser = true): Promise<SavedProject | null> {
  backendReady = false;
  const response = await fetch('/api/local-project', { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (response.status === 404 && storageKind !== 'device') {
    storageKind = 'browser';
    const project = readBrowser ? await readBrowserProject() : null;
    backendReady = true;
    return project;
  }
  if (!response.ok) throw storageError();
  const raw = await responseJSON(response, MAX_PROJECT_JSON_BYTES + 1024);
  if (!record(raw) || raw.desktop !== true || !Object.hasOwn(raw, 'project')) throw storageError();
  storageKind = 'device';
  let project: SavedProject | null;
  if (raw.project === null) {
    // Only an empty device file permits reading the old browser copy. Leave it
    // untouched; the caller's regular autosave migrates this validated snapshot.
    legacyMigration ??= readBrowserProject();
    const legacy = await legacyMigration;
    project = legacy === null ? null : normalizeProject(legacy);
  } else project = normalizeProject(raw.project);
  backendReady = true;
  return project;
}

async function writeDeviceProject(project: SavedProject): Promise<void> {
  const response = await fetch('/api/local-project', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project),
    credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw storageError();
  const raw = await responseJSON(response, 4096);
  if (!record(raw) || raw.desktop !== true || raw.saved !== true) throw storageError();
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('chanyang-note', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('브라우저 저장소를 열 수 없습니다.'));
  });
}
async function readBrowserProject(): Promise<SavedProject | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('projects', 'readonly');
      const request = tx.objectStore('projects').get('current');
      let project: SavedProject | null = null;
      let validationError: unknown;
      request.onsuccess = () => {
        try { project = request.result == null ? null : normalizeProject(request.result); }
        catch (cause) { validationError = cause; }
      };
      const fail = () => { db.close(); reject(new Error('저장된 작업을 불러올 수 없습니다.')); };
      request.onerror = fail;
      tx.onerror = fail;
      tx.onabort = fail;
      tx.oncomplete = () => { db.close(); if (validationError) reject(validationError); else resolve(project); };
    } catch (cause) { db.close(); reject(cause); }
  });
}
async function writeBrowserProject(project: SavedProject): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(project, 'current');
      tx.oncomplete = () => { db.close(); resolve(); };
      const fail = () => { db.close(); reject(new Error('브라우저에 작업을 저장하지 못했습니다.')); };
      tx.onerror = fail;
      tx.onabort = fail;
    } catch (cause) { db.close(); reject(cause); }
  });
}

export async function loadProject(): Promise<SavedProject | null> {
  await pendingWrites;
  try {
    const project = await readBackend();
    loadFailed = false;
    return project;
  } catch {
    backendReady = false;
    loadFailed = true;
    throw storageError();
  }
}

export async function saveProject(project: SavedProject): Promise<void> {
  // Validate and snapshot before touching the last valid record or waiting on IDB.
  const snapshot = normalizeProject(project);
  const saving = pendingWrites.then(async () => {
    if (loadFailed) throw storageError();
    if (!backendReady || storageKind === 'unknown') {
      try { await readBackend(false); }
      catch { loadFailed = true; throw storageError(); }
    }
    if (storageKind === 'device') await writeDeviceProject(snapshot);
    else if (storageKind === 'browser') await writeBrowserProject(snapshot);
    else throw storageError();
  });
  pendingWrites = saving.catch(() => {});
  await saving;
}
