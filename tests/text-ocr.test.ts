import assert from 'node:assert/strict';
import test from 'node:test';

const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const environment = { OMR_BASE_URL:'http://127.0.0.1:3101', OMR_AUTH_TOKEN:'private-companion-token' };
const sample = { version:1, engine:'Apple Vision + HOMR layout', elapsedMs:1200, cost:0, image:{width:500,height:700}, systems:[{index:1,top:100,bottom:200,lyrics:[{text:'주의 이름',y:180}],chords:[{text:'D/F#',x:120,y:80}]}],warnings:['원본을 확인해 주세요.'] };
function request(origin = 'http://localhost:5173', form?: FormData) {
  form ||= new FormData();
  if (!Array.from(form.keys()).length) form.append('image', new Blob([png],{type:'image/png'}),'score.png');
  return new Request('http://localhost:5173/api/text-ocr',{method:'POST',headers:{origin},body:form});
}

test('text OCR availability checks the authenticated companion capability and keeps configuration private',async()=>{
  const {getTextOcrConfig}=await import('../lib/text-ocr.ts');
  assert.deepEqual(await getTextOcrConfig({}),{configured:false});
  assert.deepEqual(await getTextOcrConfig({...environment,OMR_BASE_URL:'http://public.example'}),{configured:false});
  let calls=0;
  const status=await getTextOcrConfig(environment,async(url,init)=>{
    calls++; assert.equal(url,'http://127.0.0.1:3101/capabilities');
    assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${environment.OMR_AUTH_TOKEN}`);
    assert.equal(init?.redirect,'manual');
    return Response.json({version:1,capabilities:{recognize:true,textOcr:true}});
  });
  assert.deepEqual(status,{configured:true});assert.equal(calls,1);
  assert.equal(JSON.stringify(status).includes(environment.OMR_AUTH_TOKEN),false);
  assert.deepEqual(await getTextOcrConfig(environment,async()=>new Response(null,{status:404})),{configured:false});
  assert.deepEqual(await getTextOcrConfig(environment,async()=>Response.json({version:1,capabilities:{textOcr:false}})),{configured:false});
});

test('text OCR forwards a validated image and returns independent text without a Score',async()=>{
  const {handleTextOcrRequest}=await import('../lib/text-ocr.ts');
  let calls=0;
  const response=await handleTextOcrRequest(request(),environment,async(url,init)=>{
    calls++;assert.equal(url,'http://127.0.0.1:3101/text-ocr');assert.equal(init?.redirect,'manual');
    assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${environment.OMR_AUTH_TOKEN}`);
    assert.deepEqual(new Uint8Array(await new Response(init?.body).arrayBuffer()),png);
    return Response.json(sample);
  });
  assert.equal(response.status,200);assert.equal(calls,1);
  const data=await response.json();assert.deepEqual(data,sample);assert.equal('score' in data,false);
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('text OCR rejects cross origin, forged image, duplicate fields and oversized upload before dispatch',async()=>{
  const {handleTextOcrRequest}=await import('../lib/text-ocr.ts');
  const never=async()=>{throw Error('must not fetch');};
  assert.equal((await handleTextOcrRequest(request('https://evil.example'),environment,never)).status,403);
  assert.equal((await handleTextOcrRequest(request('invalid'),environment,never)).status,403);
  const bad=new FormData();bad.append('image',new Blob(['bad'],{type:'image/png'}),'bad.png');
  assert.equal((await handleTextOcrRequest(request(undefined,bad),environment,never)).status,400);
  const extra=new FormData();extra.append('image',new Blob([png],{type:'image/png'}),'ok.png');extra.append('path','/private');
  assert.equal((await handleTextOcrRequest(request(undefined,extra),environment,never)).status,400);
  const big=new FormData();big.append('image',new Blob([new Uint8Array(10*1024*1024+1)],{type:'image/png'}),'big.png');
  assert.equal((await handleTextOcrRequest(request(undefined,big),environment,never)).status,413);
});

test('text OCR rejects malformed or oversized output, nonzero cost and injected Score data',async()=>{
  const {handleTextOcrRequest}=await import('../lib/text-ocr.ts');
  for(const output of [null,{...sample,cost:1},{...sample,score:{notes:[]}},{...sample,systems:[{...sample.systems[0],bottom:50}]},{...sample,systems:[{...sample.systems[0],lyrics:[{text:'x',y:800}]}]}]){
    assert.equal((await handleTextOcrRequest(request(),environment,async()=>Response.json(output))).status,502);
  }
  assert.equal((await handleTextOcrRequest(request(),environment,async()=>new Response('not JSON'))).status,502);
  assert.equal((await handleTextOcrRequest(request(),environment,async()=>new Response(new Uint8Array(2*1024*1024+1)))).status,502);
  assert.equal((await handleTextOcrRequest(request(),environment,async()=>new Response(null,{status:302,headers:{location:'https://elsewhere.invalid'}}))).status,502);
});

test('text OCR cancels pending output reads when the user disconnects',async()=>{
  const {handleTextOcrRequest}=await import('../lib/text-ocr.ts');
  const abort=new AbortController();let cancelled=false;
  const pending=handleTextOcrRequest(new Request(request(),{signal:abort.signal}),environment,async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})));
  await new Promise(r=>setTimeout(r,10));abort.abort();
  assert.equal((await pending).status,499);assert.equal(cancelled,true);
});
