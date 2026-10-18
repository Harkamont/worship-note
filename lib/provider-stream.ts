type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
export class ProviderStreamError extends Error {}
type Options = { signal?: AbortSignal; maxBytes?: number; maxTextBytes?: number; onText?: (delta: string) => void; onProgress?: (value: { id?: string; model?: string; characters: number; finish: string | null }) => void };

/** OpenRouter Chat SSE: retain final text and accounting, never hidden reasoning. */
export async function readChatCompletionStream(response: Response, options: Options = {}) {
  if (!response.body) throw new Error('AI 스트림이 비어 있습니다.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let eventData: string[] = [];
  let text = '';
  let size = 0;
  let textBytes = 0;
  let done = false;
  let finish: string | null = null;
  let id: string | undefined;
  let model: string | undefined;
  let usage: ObjectValue | undefined;
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve,reject) => { rejectAbort=reject; });
  const onAbort = () => rejectAbort(options.signal?.reason ?? new DOMException('Aborted','AbortError'));
  options.signal?.addEventListener('abort',onAbort,{once:true});
  const dispatch = () => {
    if (!eventData.length) return;
    const data = eventData.join('\n'); eventData = [];
    if (data === '[DONE]') { done=true; return; }
    let frame: ObjectValue;
    try { frame=object(JSON.parse(data)); } catch { throw new Error('AI 스트림 형식이 올바르지 않습니다.'); }
    if (frame.error) throw new ProviderStreamError('AI가 변환 도중 오류를 반환했습니다.');
    if (typeof frame.id === 'string') id=frame.id;
    if (typeof frame.model === 'string') model=frame.model;
    if (frame.usage && typeof frame.usage === 'object') usage=object(frame.usage);
    const choice=object(Array.isArray(frame.choices)?frame.choices[0]:undefined);
    const delta=object(choice.delta);
    if (delta.refusal) throw new Error('AI가 변환을 거절했습니다.');
    if (typeof delta.content === 'string') {
      textBytes += new TextEncoder().encode(delta.content).byteLength;
      if (textBytes > (options.maxTextBytes ?? 2*1024*1024)) throw new Error('AI 악보 내용 크기 제한을 초과했습니다.');
      text+=delta.content; options.onText?.(delta.content);
    }
    if (typeof choice.finish_reason === 'string') finish=choice.finish_reason;
    options.onProgress?.({id,model,characters:text.length,finish});
  };
  const line = (value: string) => {
    if (!value) { dispatch(); return; }
    if (value.startsWith('data:')) eventData.push(value.slice(5).replace(/^ /,''));
  };
  try {
    options.signal?.throwIfAborted();
    while (!done) {
      const chunk=await Promise.race([reader.read(),aborted]);
      if (chunk.done) break;
      size+=chunk.value.byteLength;
      if (size>(options.maxBytes??32*1024*1024)) throw new Error('AI 스트림 크기 제한을 초과했습니다.');
      pending+=decoder.decode(chunk.value,{stream:true});
      let end: number;
      while ((end=pending.indexOf('\n'))>=0) {
        const value=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);line(value);
      }
    }
    pending+=decoder.decode();
    if (pending) line(pending.replace(/\r$/,''));
    dispatch();
    if (!done || !finish) throw new Error('AI 스트림이 완료되기 전에 끝났습니다.');
    return { id, model, choices:[{finish_reason:finish,message:{content:text}}], ...(usage?{usage}:{} ) };
  } finally {
    options.signal?.removeEventListener('abort',onAbort);
    void reader.cancel().catch(()=>{});
    try { reader.releaseLock(); } catch { /* A cancelled read may still settle. */ }
  }
}
