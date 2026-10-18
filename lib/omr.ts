import { parseMusicXML } from './musicxml-import.ts';
import { analyzeMusicXML } from './musicxml-review.ts';
import type { RecognitionResult } from './score-types.ts';
import type { MusicXMLRecognitionResult } from './recognition.ts';

export type OmrEnvironment = { OMR_BASE_URL?: string; OMR_AUTH_TOKEN?: string };
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_XML = 2 * 1024 * 1024;
let activeRequest = false;
class OmrError extends Error { status: number; constructor(status: number) { super('OMR failed'); this.status = status; } }
function configuration(environment: OmrEnvironment) {
  const token = environment.OMR_AUTH_TOKEN?.trim();
  const raw = environment.OMR_BASE_URL?.trim();
  if (!token || !raw) return null;
  try {
    const url = new URL(raw);
    const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) return null;
    return { token, url: url.href.replace(/\/+$/, '') + '/recognize' };
  } catch { return null; }
}
export function getOmrConfig(environment: OmrEnvironment): { configured: boolean } { return { configured: Boolean(configuration(environment)) }; }

async function bounded(body: ReadableStream<Uint8Array> | null, max: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) throw new OmrError(400);
  if (signal.aborted) throw new OmrError(499);
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let length = 0; let complete = false;
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve,reject) => { abort = () => reject(new OmrError(499)); signal.addEventListener('abort',abort,{once:true}); });
  try {
    if (signal.aborted) throw new OmrError(499);
    while (true) {
      const {done,value} = await Promise.race([reader.read(),cancelled]);
      if (done) { complete=true; break; }
      length += value.length; if (length > max) throw new OmrError(413); chunks.push(value);
    }
  } finally { if (abort) signal.removeEventListener('abort',abort); if (!complete) void reader.cancel().catch(()=>{}); reader.releaseLock(); }
  const result = new Uint8Array(length); let offset=0;
  for (const chunk of chunks) { result.set(chunk,offset); offset+=chunk.length; }
  return result;
}
function errorResponse(status: number) {
  const message = status===503 ? '로컬 악보 인식이 연결되지 않았습니다.' : status===429 ? '다른 악보를 인식하고 있습니다. 잠시 후 다시 시도해 주세요.' : status===413 ? '이미지는 10MB 이하로 올려 주세요.' : status===400 ? '올바른 PNG 또는 JPG 이미지 한 개를 올려 주세요.' : status===403 ? '같은 사이트에서 보낸 요청만 처리할 수 있습니다.' : status===504 ? '악보 인식 시간이 초과되었습니다.' : status===499 ? '악보 인식을 취소했습니다.' : '로컬 악보 인식을 완료하지 못했습니다. 원본을 확인한 뒤 다시 시도해 주세요.';
  return Response.json({error:{code:'OMR_FAILED',message}}, {status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}

async function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new OmrError(499);
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => { abort = () => reject(new OmrError(499)); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
  try { return await Promise.race([promise, stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}

async function handleOmr(request: Request, environment: OmrEnvironment, fetcher: Fetcher, documentMode: boolean): Promise<Response> {
  const controller = new AbortController(); let timedOut=false;
  let ownsRequest = false;
  const onAbort=()=>controller.abort(); request.signal.addEventListener('abort',onAbort,{once:true});
  if (request.signal.aborted) controller.abort();
  const timer = setTimeout(()=>{timedOut=true;controller.abort();},75_000);
  try {
    const origin=request.headers.get('origin');
    let sameOrigin=false;
    try { sameOrigin=Boolean(origin) && new URL(origin!).origin===new URL(request.url).origin; } catch { /* Invalid origins are rejected. */ }
    if (!sameOrigin || request.headers.get('sec-fetch-site')==='cross-site') throw new OmrError(403);
    const config=configuration(environment); if (!config) throw new OmrError(503);
    const contentType=request.headers.get('content-type')||'';
    if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new OmrError(400);
    if (Number(request.headers.get('content-length'))>MAX_IMAGE+65536) throw new OmrError(413);
    if (activeRequest) throw new OmrError(429);
    activeRequest = true; ownsRequest = true;
    const bytes=await bounded(request.body,MAX_IMAGE+65536,controller.signal);
    let form: FormData;
    try { form=await new Response(bytes,{headers:{'content-type':contentType}}).formData(); } catch { throw new OmrError(400); }
    const entries=Array.from(form.entries());
    if (entries.length!==1 || entries[0][0]!=='image' || typeof entries[0][1]==='string') throw new OmrError(400);
    const file=entries[0][1]; if (!file.size || file.size>MAX_IMAGE) throw new OmrError(file.size>MAX_IMAGE?413:400);
    const image=new Uint8Array(await file.arrayBuffer());
    const png=[137,80,78,71,13,10,26,10].every((value,index)=>image[index]===value);
    const jpeg=image.length>=4 && image[0]===255 && image[1]===216 && image[2]===255;
    if (!((file.type==='image/png'&&png)||(file.type==='image/jpeg'&&jpeg))) throw new OmrError(400);
    if (controller.signal.aborted) throw new OmrError(499);
    const started=Date.now();
    const response=await untilAbort(fetcher(config.url,{method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':file.type},body:image,signal:controller.signal,redirect:'manual'}),controller.signal);
    if (!response.ok) { void response.body?.cancel().catch(()=>{}); throw new OmrError(response.status===429?429:response.status===504?504:502); }
    if (Number(response.headers.get('content-length'))>MAX_XML) { void response.body?.cancel().catch(()=>{}); throw new OmrError(502); }
    let output: Uint8Array<ArrayBuffer>;
    try { output=await bounded(response.body,MAX_XML,controller.signal); }
    catch (error) { if (error instanceof OmrError && error.status===413) throw new OmrError(502); throw error; }
    let xml: string;
    try { xml = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(output); } catch { throw new OmrError(502); }
    const parsingXML = xml.replace(/^\uFEFF/, '');
    if (documentMode) {
      let document;
      try { document = { ...analyzeMusicXML(parsingXML), xml }; } catch { throw new OmrError(502); }
      document.issues.push({ severity: 'warning', code: 'TEXT_ANNOTATION_PENDING', message: 'HOMR의 음표 인식 결과입니다. 코드·가사는 아직 추가하지 않았습니다. 원본 이미지와 음표를 비교해 주세요.' });
      let score: MusicXMLRecognitionResult['score'] = null;
      let editorIssue: string | null = null;
      try { score = parseMusicXML(parsingXML); }
      catch (error) { editorIssue = (error instanceof Error ? error.message : '편집기가 지원하지 않는 XML입니다. 원본 XML 검토를 사용해 주세요.').slice(0, 16_000); }
      const result: MusicXMLRecognitionResult = { document, score, editorIssue, provider: 'local-omr', model: 'HOMR', elapsedMs: Date.now()-started, usage: null, cost: 0 };
      return Response.json(result,{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }
    let score;
    try { score=parseMusicXML(parsingXML); } catch { throw new OmrError(502); }
    const result: RecognitionResult & { cost: number }={score,provider:'local-omr',model:'HOMR',elapsedMs:Date.now()-started,usage:null,cost:0};
    return Response.json(result,{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  } catch (error) { return errorResponse(timedOut?504:request.signal.aborted?499:error instanceof OmrError?error.status:502); }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort',onAbort); if (ownsRequest) activeRequest = false; }
}

export async function handleOmrRequest(request: Request, environment: OmrEnvironment, fetcher: Fetcher = fetch): Promise<Response> { return handleOmr(request, environment, fetcher, false); }
export async function handleOmrDocumentRequest(request: Request, environment: OmrEnvironment, fetcher: Fetcher = fetch): Promise<Response> { return handleOmr(request, environment, fetcher, true); }
