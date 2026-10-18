import type { OmrEnvironment } from './omr.ts';

export type TextOcrEnvironment = OmrEnvironment;
export interface TextOcrSystem {
  index: number;
  top: number;
  bottom: number;
  lyrics: { text: string; y: number }[];
  chords: { text: string; x: number; y: number }[];
}
export interface TextOcrResult {
  version: 1;
  engine: string;
  elapsedMs: number;
  cost: 0;
  image: { width: number; height: number };
  systems: TextOcrSystem[];
  warnings: string[];
}
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_OUTPUT = 2 * 1024 * 1024;
class TextOcrError extends Error { status: number; constructor(status: number) { super('Text OCR failed'); this.status = status; } }
function configuration(environment: TextOcrEnvironment) {
  const token=environment.OMR_AUTH_TOKEN?.trim(); const raw=environment.OMR_BASE_URL?.trim();
  if (!token || !raw) return null;
  try {
    const url=new URL(raw); const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if ((url.protocol!=='https:' && !(url.protocol==='http:' && local)) || url.username || url.password || url.search || url.hash) return null;
    return { token, base:url.href.replace(/\/+$/,'') };
  } catch { return null; }
}
async function bounded(body: ReadableStream<Uint8Array> | null, max: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) throw new TextOcrError(400);
  if (signal.aborted) throw new TextOcrError(499);
  const reader=body.getReader(); const chunks: Uint8Array[]=[]; let length=0; let complete=false;
  let abort:(()=>void)|undefined;
  const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(new TextOcrError(499));signal.addEventListener('abort',abort,{once:true});});
  try {
    if (signal.aborted) throw new TextOcrError(499);
    while (true) {
      const {done,value}=await Promise.race([reader.read(),cancelled]);
      if (done) {complete=true;break;}
      length+=value.length;if (length>max) throw new TextOcrError(413);chunks.push(value);
    }
  } finally {if (abort) signal.removeEventListener('abort',abort);if (!complete) void reader.cancel().catch(()=>{});reader.releaseLock();}
  const result=new Uint8Array(length);let offset=0;for (const chunk of chunks) {result.set(chunk,offset);offset+=chunk.length;}return result;
}

export async function getTextOcrConfig(environment: TextOcrEnvironment, fetcher: Fetcher = fetch): Promise<{configured:boolean}> {
  const config=configuration(environment);if (!config) return {configured:false};
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),2000);
  try {
    const response=await fetcher(config.base+'/capabilities',{method:'GET',headers:{authorization:`Bearer ${config.token}`},signal:controller.signal,redirect:'manual'});
    if (!response.ok) {void response.body?.cancel().catch(()=>{});return {configured:false};}
    const bytes=await bounded(response.body,4096,controller.signal);
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    return {configured:data?.version===1 && data?.capabilities?.textOcr===true};
  } catch {return {configured:false};}
  finally {clearTimeout(timer);}
}
function object(value: unknown, keys: string[]): Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new TextOcrError(502);
  const record=value as Record<string,unknown>;
  if (Object.keys(record).length!==keys.length || keys.some(key=>!Object.hasOwn(record,key))) throw new TextOcrError(502);
  return record;
}
function text(value: unknown, max: number): string {
  if (typeof value!=='string' || value.length>max || /[\u0000-\u001f\u007f]/.test(value)) throw new TextOcrError(502);
  return value;
}
function number(value: unknown, max: number, min=0): number {
  if (typeof value!=='number' || !Number.isFinite(value) || value<min || value>max) throw new TextOcrError(502);
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length>max) throw new TextOcrError(502);return value;
}
function readResult(value: unknown): TextOcrResult {
  const data=object(value,['version','engine','elapsedMs','cost','image','systems','warnings']);
  if (data.version!==1 || data.cost!==0) throw new TextOcrError(502);
  const image=object(data.image,['width','height']);const width=number(image.width,100000,1);const height=number(image.height,100000,1);
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new TextOcrError(502);
  const indices=new Set<number>();
  const systems=array(data.systems,512).map(value=>{
    const system=object(value,['index','top','bottom','lyrics','chords']);const index=number(system.index,512,1);
    if (!Number.isInteger(index) || indices.has(index)) throw new TextOcrError(502);indices.add(index);
    const top=number(system.top,height);const bottom=number(system.bottom,height);if (bottom<=top) throw new TextOcrError(502);
    const lyrics=array(system.lyrics,64).map(value=>{const item=object(value,['text','y']);return {text:text(item.text,4000),y:number(item.y,height)};});
    const chords=array(system.chords,512).map(value=>{const item=object(value,['text','x','y']);return {text:text(item.text,200),x:number(item.x,width),y:number(item.y,height)};});
    return {index,top,bottom,lyrics,chords};
  });
  return {version:1,engine:text(data.engine,200),elapsedMs:number(data.elapsedMs,3_600_000),cost:0,image:{width,height},systems,warnings:array(data.warnings,128).map(value=>text(value,2000))};
}
function errorResponse(status: number) {
  const message=status===503?'로컬 가사·코드 인식이 연결되지 않았습니다.':status===429?'다른 악보를 인식하고 있습니다. 잠시 후 다시 시도해 주세요.':status===413?'이미지는 10MB 이하로 올려 주세요.':status===400?'올바른 PNG 또는 JPG 이미지 한 개를 올려 주세요.':status===403?'같은 사이트에서 보낸 요청만 처리할 수 있습니다.':status===504?'가사·코드 인식 시간이 초과되었습니다.':status===499?'가사·코드 인식을 취소했습니다.':'로컬 가사·코드 인식을 완료하지 못했습니다.';
  return Response.json({error:{code:'TEXT_OCR_FAILED',message}},{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}

export async function handleTextOcrRequest(request: Request, environment: TextOcrEnvironment, fetcher: Fetcher = fetch): Promise<Response> {
  const controller=new AbortController();let timedOut=false;
  const onAbort=()=>controller.abort();request.signal.addEventListener('abort',onAbort,{once:true});if (request.signal.aborted) controller.abort();
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},75_000);
  try {
    const origin=request.headers.get('origin');let sameOrigin=false;
    try {sameOrigin=Boolean(origin)&&new URL(origin!).origin===new URL(request.url).origin;} catch { /* Invalid origins are rejected. */ }
    if (!sameOrigin || request.headers.get('sec-fetch-site')==='cross-site') throw new TextOcrError(403);
    const config=configuration(environment);if (!config) throw new TextOcrError(503);
    const contentType=request.headers.get('content-type')||'';if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new TextOcrError(400);
    if (Number(request.headers.get('content-length'))>MAX_IMAGE+65536) throw new TextOcrError(413);
    const bytes=await bounded(request.body,MAX_IMAGE+65536,controller.signal);
    let form:FormData;try {form=await new Response(bytes,{headers:{'content-type':contentType}}).formData();} catch {throw new TextOcrError(400);}
    const entries=Array.from(form.entries());if (entries.length!==1 || entries[0][0]!=='image' || typeof entries[0][1]==='string') throw new TextOcrError(400);
    const file=entries[0][1];if (!file.size || file.size>MAX_IMAGE) throw new TextOcrError(file.size>MAX_IMAGE?413:400);
    const image=new Uint8Array(await file.arrayBuffer());
    const png=[137,80,78,71,13,10,26,10].every((value,index)=>image[index]===value);const jpeg=image.length>=4 && image[0]===255 && image[1]===216 && image[2]===255;
    if (!((file.type==='image/png'&&png)||(file.type==='image/jpeg'&&jpeg))) throw new TextOcrError(400);
    const response=await fetcher(config.base+'/text-ocr',{method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':file.type},body:image,signal:controller.signal,redirect:'manual'});
    if (!response.ok) {void response.body?.cancel().catch(()=>{});throw new TextOcrError([429,503,504].includes(response.status)?response.status:502);}
    if (Number(response.headers.get('content-length'))>MAX_OUTPUT) {void response.body?.cancel().catch(()=>{});throw new TextOcrError(502);}
    let output:Uint8Array<ArrayBuffer>;
    try {output=await bounded(response.body,MAX_OUTPUT,controller.signal);} catch(error) {if (error instanceof TextOcrError && error.status===413) throw new TextOcrError(502);throw error;}
    let data:TextOcrResult;try {data=readResult(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(output)));} catch {throw new TextOcrError(502);}
    return Response.json(data,{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  } catch(error) {return errorResponse(timedOut?504:request.signal.aborted?499:error instanceof TextOcrError?error.status:502);}
  finally {clearTimeout(timer);request.signal.removeEventListener('abort',onAbort);}
}
