import type { SavedProject } from './project-storage.ts';
import { validateScore } from './music.ts';
import { normalizeImageDataURL, normalizeRecognitionMetadata, normalizeReviewWorkspace } from './review-workspace.ts';

export const MAX_PROJECT_JSON_BYTES = 45 * 1024 * 1024;

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(field + ' 형식이 올바르지 않습니다.');
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(field + ' 길이 또는 형식이 올바르지 않습니다.');
  return value;
}

function checkJSONSize(value: string): void {
  // The character check avoids allocating an encoded copy of an already excessive file.
  if (value.length > MAX_PROJECT_JSON_BYTES || new TextEncoder().encode(value).byteLength > MAX_PROJECT_JSON_BYTES) throw new Error('프로젝트 JSON은 45MiB 이하여야 합니다.');
}

function timestamp(value: unknown): string {
  const iso = text(value, '저장 날짜', 40, true);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!match) throw new Error('저장 날짜는 시간대가 포함된 ISO 날짜여야 합니다.');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || !Number.isFinite(Date.parse(iso))) throw new Error('저장 날짜가 실제 달력·시간과 일치하지 않습니다.');
  return iso;
}

export function normalizeProject(value: unknown): SavedProject {
  const raw = object(value, '프로젝트');
  const normalized: SavedProject = {
    score: validateScore(raw.score),
    originalImage: normalizeImageDataURL(raw.originalImage),
    originalName: text(raw.originalName, '원본 파일 이름', 256),
    recognition: raw.recognition === null ? null : normalizeRecognitionMetadata(raw.recognition),
    updatedAt: timestamp(raw.updatedAt),
    ...(raw.reviewWorkspace !== undefined ? { reviewWorkspace: normalizeReviewWorkspace(raw.reviewWorkspace) } : {}),
  };
  checkJSONSize(JSON.stringify({ format: 'chanyang-project', version: 1, ...normalized }, null, 2));
  return normalized;
}

export function serializeProject(value: SavedProject): string {
  const serialized = JSON.stringify({ format: 'chanyang-project', version: 1, ...normalizeProject(value) }, null, 2);
  checkJSONSize(serialized);
  return serialized;
}

export function parseProject(value: string): SavedProject {
  if (typeof value !== 'string') throw new Error('프로젝트 JSON 문자열이 필요합니다.');
  checkJSONSize(value);
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error('프로젝트 JSON을 읽을 수 없습니다.'); }
  const raw = object(parsed, '프로젝트');
  if (raw.format === 'chanyang-project' && raw.version === 1) return normalizeProject(raw);
  if (raw.format === undefined && raw.score === undefined && raw.version === 1) return { score: validateScore(raw), originalImage: null, originalName: '', recognition: null, updatedAt: new Date().toISOString() };
  throw new Error('지원하지 않는 프로젝트 형식 또는 버전입니다.');
}
