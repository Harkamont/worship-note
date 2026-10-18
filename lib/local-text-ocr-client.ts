export type LocalTextDraft = {
  version: 1;
  engine: string;
  elapsedMs: number;
  cost: 0;
  image: { width: number; height: number };
  systems: {
    index: number; top: number; bottom: number;
    lyrics: { text: string; y: number }[];
    chords: { text: string; x: number; y: number }[];
  }[];
  warnings: string[];
};
export type EditableTextSystem = { index: number; lyrics: string; chords: string };

export function localTextImageSupported(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    && width <= 2500 && height <= 2500 && width * height <= 4_000_000;
}

export function toEditableTextSystems(draft: LocalTextDraft): EditableTextSystem[] {
  return [...draft.systems].sort((a, b) => a.top - b.top).map(system => {
    const rows: { y: number; chords: typeof system.chords }[] = [];
    const tolerance = Math.max(3, Math.min(18, (system.bottom - system.top) * .33));
    for (const chord of [...system.chords].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const row = rows.find(item => Math.abs(item.y - chord.y) <= tolerance);
      if (row) row.chords.push(chord);
      else rows.push({ y: chord.y, chords: [chord] });
    }
    return {
      index: system.index,
      lyrics: system.lyrics.map(lyric => lyric.text).join('\n'),
      chords: rows.map(row => row.chords.sort((a, b) => a.x - b.x).map(chord => chord.text).join('  ')).join('\n'),
    };
  });
}

export function localTextDownload(systems: EditableTextSystem[], warnings: string[] = []): string {
  return ['가사·코드 텍스트 초안', '음표·박 연결 전 텍스트 초안입니다. 원본과 확인해 주세요.',
    ...(warnings.length ? ['\n확인할 내용', ...warnings.map(warning => `- ${warning}`)] : []),
    ...systems.map(system => `\n[${system.index}번째 줄]\n코드\n${system.chords}\n가사\n${system.lyrics}`),
  ].join('\n');
}

export async function requestLocalTextDraft(file: File, options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<LocalTextDraft> {
  options.signal?.throwIfAborted();
  const body = new FormData(); body.append('image', file);
  const response = await (options.fetcher ?? fetch)('/api/text-ocr', { method: 'POST', body, signal: options.signal });
  options.signal?.throwIfAborted();
  const data = await response.json().catch(() => null) as (Partial<LocalTextDraft> & { error?: { message?: string } }) | null;
  options.signal?.throwIfAborted();
  if (!response.ok) throw new Error(data?.error?.message || '가사·코드를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
  if (!data || data.version !== 1 || data.cost !== 0 || !Array.isArray(data.systems) || !Array.isArray(data.warnings)) {
    throw new Error('텍스트 초안을 받지 못했습니다. 다시 시도해 주세요.');
  }
  return data as LocalTextDraft;
}

