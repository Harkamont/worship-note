import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeScore } from '../lib/recognition-client.ts';
import { createSampleScore } from '../lib/sample.ts';
import type { RecognitionResult } from '../lib/score-types.ts';
const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'sample.png', {type:'image/png'});
const result = (model:string, cost?:number):RecognitionResult => ({score:createSampleScore(),model,provider:model==='HOMR'?'local-omr':'vision',elapsedMs:100,usage:null,...(cost===undefined?{}:{cost})});

test('hybrid sends the OMR score to annotations and combines only reported costs', async()=>{
  const omr=result('HOMR',0); omr.score.title='OMR draft'; const anno=result('vision',0.002);
  const calls:string[]=[];
  const output=await recognizeScore(file,'hybrid',createSampleScore(),{fetcher:async(url,options)=>{
    calls.push(url); const form=options!.body as FormData;
    if(url==='/api/omr') {assert.equal(form.get('score'),null);return Response.json(omr);}
    assert.deepEqual(JSON.parse(String(form.get('score'))),omr.score); return Response.json(anno);
  }});
  assert.deepEqual(calls,['/api/omr','/api/annotate']);assert.equal(output.cost,0.002);assert.equal(output.elapsedMs,200);assert.equal(output.model,'HOMR + vision');
});

test('failed OMR never starts an AI request',async()=>{
  let calls=0;await assert.rejects(recognizeScore(file,'hybrid',undefined,{fetcher:async()=>{calls++;return Response.json({error:{message:'원본 확인'}},{status:502});}}),/원본 확인/);assert.equal(calls,1);
});

test('cancelling after OMR prevents the next paid request',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(recognizeScore(file,'hybrid',undefined,{signal:controller.signal,fetcher:async()=>{calls++;controller.abort();return Response.json(result('HOMR',0));}}),e=>e instanceof Error&&e.name==='AbortError');assert.equal(calls,1);
});

test('annotation-only keeps the supplied score and missing costs stay unknown',async()=>{
  const score=createSampleScore();const anno=result('vision');const out=await recognizeScore(file,'annotations',score,{fetcher:async(url,init)=>{assert.equal(url,'/api/annotate');assert.deepEqual(JSON.parse(String((init!.body as FormData).get('score'))),score);return Response.json(anno);}});assert.equal(out.cost,undefined);
  const mixed=await recognizeScore(file,'hybrid',undefined,{fetcher:async(url)=>Response.json(url==='/api/omr'?result('HOMR',0):anno)});assert.equal(mixed.cost,undefined);
});
