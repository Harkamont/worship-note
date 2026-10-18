import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_PROJECT_JSON_BYTES, normalizeProject } from '../lib/project-io.ts';
import type { SavedProject } from '../lib/project-storage.ts';
import { settingsDirectory } from './settings-host.ts';

const reply = (status: number, data: unknown) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

async function storageDirectory(path: string, create: boolean): Promise<boolean> {
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (!missing(error)) throw error;
    if (!create) return false;
    await mkdir(path, { recursive: true, mode: 0o700 });
    info = await lstat(path);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Invalid project directory');
  if (create) await chmod(path, 0o700);
  return true;
}

async function regularFile(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Invalid project file');
  } catch (error) { if (!missing(error)) throw error; }
}

async function storagePaths(directory: string, create: boolean): Promise<string | null> {
  if (!await storageDirectory(directory, create)) return null;
  const projects = join(directory, 'projects');
  if (!await storageDirectory(projects, create)) return null;
  await regularFile(join(projects, 'current.json'));
  await regularFile(join(projects, 'current.backup.json'));
  return projects;
}

async function readProject(directory: string): Promise<{ project: SavedProject; contents: Buffer } | null> {
  const projects = await storagePaths(directory, false);
  if (!projects) return null;
  let file;
  try { file = await open(join(projects, 'current.json'), constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
  catch (error) { if (missing(error)) return null; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_PROJECT_JSON_BYTES) throw new Error('Invalid project file');
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_PROJECT_JSON_BYTES + 1 - size));
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_PROJECT_JSON_BYTES) throw new Error('Project file too large');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const contents = Buffer.concat(chunks);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contents));
    return { project: normalizeProject(value), contents };
  } finally { await file.close(); }
}

async function writeTemporary(path: string, contents: string | Buffer): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  try { await file.writeFile(contents); await file.sync(); }
  finally { await file.close(); }
}

async function persistProject(directory: string, project: SavedProject): Promise<void> {
  const projects = await storagePaths(directory, true);
  if (!projects) throw new Error('Missing project directory');
  const previous = await readProject(directory);
  const identifier = `${process.pid}-${crypto.randomUUID()}`;
  const temporary = join(projects, `current-${identifier}.tmp`);
  const backupTemporary = join(projects, `backup-${identifier}.tmp`);
  try {
    await writeTemporary(temporary, JSON.stringify(project) + '\n');
    if (previous) {
      await writeTemporary(backupTemporary, previous.contents);
      await storagePaths(directory, false);
      await rename(backupTemporary, join(projects, 'current.backup.json'));
    }
    await storagePaths(directory, false);
    await rename(temporary, join(projects, 'current.json'));
  } finally {
    await unlink(temporary).catch(() => {});
    await unlink(backupTemporary).catch(() => {});
  }
}

async function incomingProject(request: Request): Promise<SavedProject | Response> {
  if (Number(request.headers.get('content-length')) > MAX_PROJECT_JSON_BYTES) return reply(413, { error: '프로젝트는 45MiB 이하여야 합니다.' });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader) while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_PROJECT_JSON_BYTES) {
        await reader.cancel().catch(() => {});
        return reply(413, { error: '프로젝트는 45MiB 이하여야 합니다.' });
      }
      chunks.push(next.value);
    }
    return normalizeProject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
  } catch { return reply(400, { error: '프로젝트 내용을 확인해 주세요.' }); }
  finally { reader?.releaseLock(); }
}

export function createProjectHandler({ directory = settingsDirectory(), environment = process.env }: { directory?: string; environment?: NodeJS.ProcessEnv } = {}) {
  let sequence = Promise.resolve();
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const authority = `127.0.0.1:${environment.CHANYANG_PORT || '3210'}`;
    const origin = `http://${authority}`;
    if (url.origin !== origin || url.username || url.password || request.headers.get('host') !== authority || (request.headers.has('origin') && request.headers.get('origin') !== origin)) return reply(403, { error: '이 컴퓨터의 앱에서만 프로젝트를 사용할 수 있습니다.' });
    if (request.method !== 'GET' && request.method !== 'PUT') return reply(405, { error: '지원하지 않는 요청입니다.' });
    if (request.method === 'PUT' && (request.headers.get('origin') !== origin || request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')) return reply(403, { error: '앱 화면에서 프로젝트를 저장해 주세요.' });

    // Keep request order, including reads that arrive while a save is in progress.
    let release!: () => void;
    const previous = sequence;
    sequence = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (request.method === 'GET') return reply(200, { desktop: true, project: (await readProject(directory))?.project ?? null });
      const project = await incomingProject(request);
      if (project instanceof Response) return project;
      await persistProject(directory, project);
      return reply(200, { desktop: true, saved: true });
    } catch { return reply(503, { error: '저장된 프로젝트를 읽거나 저장할 수 없습니다. 기존 파일을 확인해 주세요.' }); }
    finally { release(); }
  };
}

export const handleLocalProject = createProjectHandler();
