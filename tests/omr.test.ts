import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecognitionResult } from '../lib/score-types.ts';

const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const environment = { OMR_BASE_URL:'http://127.0.0.1:3101', OMR_AUTH_TOKEN:'private-companion-token' };
const xml = '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
function request(origin = 'http://localhost:5173') {
  const form = new FormData(); form.append('image', new Blob([png], {type:'image/png'}), 'score.png');
  return new Request('http://localhost:5173/api/omr', {method:'POST',headers:{origin},body:form});
}

test('OMR config is private, rejects insecure remote base and defaults off', async () => {
  const { getOmrConfig } = await import('../lib/omr.ts');
  assert.deepEqual(getOmrConfig({}), {configured:false});
  assert.deepEqual(getOmrConfig(environment), {configured:true});
  assert.deepEqual(getOmrConfig({...environment, OMR_BASE_URL:'http://public.example'}), {configured:false});
  assert.equal(JSON.stringify(getOmrConfig(environment)).includes(environment.OMR_AUTH_TOKEN),false);
});

test('bridge forwards only validated image with server token and returns strict Score', async () => {
  const { handleOmrRequest } = await import('../lib/omr.ts');
  let calls=0;
  const response = await handleOmrRequest(request(), environment, async (url, init) => {
    calls++;
    assert.equal(String(url),'http://127.0.0.1:3101/recognize');
    assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${environment.OMR_AUTH_TOKEN}`);
    assert.deepEqual(new Uint8Array(await new Response(init?.body).arrayBuffer()),png);
    return new Response(xml,{headers:{'content-type':'application/vnd.recordare.musicxml+xml'}});
  });
  assert.equal(response.status,200);
  const data = await response.json() as RecognitionResult & {cost:number};
  assert.equal(calls,1); assert.equal(data.provider,'local-omr'); assert.equal(data.model,'HOMR'); assert.equal(data.cost,0); assert.equal(data.usage,null);
  assert.equal(data.score.sections[0].measures[0].notes[0].pitch,'C4');
  assert.equal(JSON.stringify(data).includes(environment.OMR_AUTH_TOKEN),false);
});

test('bridge rejects cross origin, extra multipart fields and forged image before fetch', async () => {
  const { handleOmrRequest } = await import('../lib/omr.ts');
  const fetcher = async () => { throw new Error('must not fetch'); };
  assert.equal((await handleOmrRequest(request('https://evil.example'),environment,fetcher)).status,403);
  assert.equal((await handleOmrRequest(request('invalid origin'),environment,fetcher)).status,403);
  const form = new FormData(); form.append('image',new Blob(['bad'],{type:'image/png'}),'score.png');
  assert.equal((await handleOmrRequest(new Request('http://localhost:5173/api/omr',{method:'POST',headers:{origin:'http://localhost:5173'},body:form}),environment,fetcher)).status,400);
  form.set('image',new Blob([png],{type:'image/png'}),'score.png'); form.append('path','/private');
  assert.equal((await handleOmrRequest(new Request('http://localhost:5173/api/omr',{method:'POST',headers:{origin:'http://localhost:5173'},body:form}),environment,fetcher)).status,400);
});

test('bridge bounds output without trusting content-length, rejects invalid XML and cancels reads on disconnect', async () => {
  const { handleOmrRequest } = await import('../lib/omr.ts');
  assert.equal((await handleOmrRequest(request(),environment,async()=>new Response('invalid XML'))).status,502);
  assert.equal((await handleOmrRequest(request(),environment,async()=>new Response(new Uint8Array(2*1024*1024+1)))).status,502);
  const abort = new AbortController();
  const original=request();
  const interrupted=new Request(original,{signal:abort.signal});
  let cancelled=false;let markReading:()=>void=()=>{};
  const reading=new Promise<void>(resolve=>{markReading=resolve;});
  const result=handleOmrRequest(interrupted,environment,async()=>new Response(new ReadableStream({pull(){markReading();},cancel(){cancelled=true;}},{highWaterMark:0})));
  await reading; abort.abort();
  assert.equal((await result).status,499);
  assert.equal(cancelled,true);
});

test('uses Worker-supported manual redirects and rejects a redirect without forwarding credentials',async()=>{
  const {handleOmrRequest}=await import('../lib/omr.ts');
  let calls=0;let redirect:RequestRedirect|undefined;
  const result=await handleOmrRequest(request(),environment,async(_url,init)=>{
    calls++;redirect=init?.redirect;return new Response(null,{status:302,headers:{location:'https://elsewhere.invalid'}});
  });
  assert.equal(redirect,'manual');assert.equal(calls,1);assert.equal(result.status,502);
});
