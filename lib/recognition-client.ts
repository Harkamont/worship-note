import { validateScore } from './music.ts';
import type { Score, RecognitionResult } from './score-types.ts';
export type RecognitionMode = 'full' | 'annotations' | 'omr' | 'hybrid';
type Options = { signal?: AbortSignal; fetcher?: (url: string, options?: RequestInit) => Promise<Response> };

export async function recognizeScore(file: File, mode: RecognitionMode, score?: Score, options: Options = {}): Promise<RecognitionResult> {
  const fetcher = options.fetcher ?? fetch;
  const request = async (endpoint: string, lockedScore?: Score): Promise<RecognitionResult> => {
    options.signal?.throwIfAborted();
    const body = new FormData(); body.append('image', file);
    if (lockedScore) body.append('score', JSON.stringify(validateScore(lockedScore)));
    const response = await fetcher(endpoint, { method: 'POST', body, signal: options.signal });
    const data = await response.json() as RecognitionResult & { error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message ?? '악보 인식을 완료하지 못했습니다.');
    return { ...data, score: validateScore(data.score) };
  };
  if (mode === 'annotations') {
    if (!score) throw new Error('코드·가사를 채울 악보를 먼저 열어 주세요.');
    return request('/api/annotate', score);
  }
  if (mode === 'full') return request('/api/recognize');
  const omr = await request('/api/omr');
  if (mode === 'omr') return omr;
  const annotations = await request('/api/annotate', omr.score);
  return {
    ...annotations,
    model: `${omr.model} + ${annotations.model}`.slice(0, 200),
    provider: `${omr.provider} + ${annotations.provider}`.slice(0, 64),
    elapsedMs: omr.elapsedMs + annotations.elapsedMs,
    ...(omr.cost !== undefined && annotations.cost !== undefined ? { cost: omr.cost + annotations.cost } : { cost: undefined }),
  };
}
