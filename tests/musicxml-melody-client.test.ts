import test from 'node:test';
import assert from 'node:assert/strict';
import type { MusicXMLRecognitionResult } from '../lib/recognition.ts';
const xml='<score-partwise version="4.0"><work><work-title>찬송가</work-title></work><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note></measure></part></score-partwise>';
const source=()=>({document:{xml},score:null,editorIssue:'original draft',model:'original-recognizer',provider:'openai-compatible',elapsedMs:44000,usage:{inputTokens:300,outputTokens:500,totalTokens:800,cachedTokens:0},cost:0.025}) as MusicXMLRecognitionResult;
async function helper(){const mod=await import('../lib/musicxml-melody-client.ts').catch(()=>null);assert.ok(mod&&typeof mod.reviewExtractedMelody==='function','melody review helper must exist');return mod.reviewExtractedMelody;}
test('a local melody review preserves original paid metadata and source XML',async()=>{const input=source();const before=JSON.stringify(input);const result=(await helper())(input,{xml,warnings:['선택 성부를 확인해 주세요.']});assert.equal(JSON.stringify(input),before);assert.equal(result.cost,input.cost);assert.deepEqual(result.usage,input.usage);assert.equal(result.model,input.model);assert.equal(result.provider,input.provider);assert.equal(result.elapsedMs,input.elapsedMs);assert.ok(result.score);assert.equal(result.document.xml,xml);assert.ok(result.document.issues.some(issue=>issue.code==='MELODY_EXTRACTION_NOTICE'));});
test('unsupported melody notation stays downloadable and is not silently simplified for the editor',async()=>{const complex=xml.replace('<type>whole</type>','<type>whole</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');const result=(await helper())(source(),{xml:complex,warnings:[]});assert.equal(result.document.xml,complex);assert.equal(result.score,null);assert.ok(result.editorIssue);assert.equal(result.cost,0.025);});
test('malformed extracted XML is rejected without replacing the source',async()=>{const input=source();const fn=await helper();assert.throws(()=>fn(input,{xml:'<score-partwise>',warnings:[]}));assert.equal(input.document.xml,xml);});
test('a deliberate rhythm review draft retains structure errors and the original receipt',async()=>{
  const overfull=xml.replace('<beats>4</beats>','<beats>3</beats>');
  const input=source();const before=JSON.stringify(input);const fn=await helper();
  const strict=fn(input,{xml:overfull,warnings:[]});
  assert.equal(strict.score,null);
  const draft=fn(input,{xml:overfull,warnings:['원본 박자 확인']},{reviewDraft:true});
  assert.ok(draft.score,'An explicitly requested rhythm draft should be editable');
  assert.equal(draft.score.sections[0].measures[0].rhythmReview,true);
  assert.equal(draft.score.sections[0].measures[0].notes[0].duration,'w');
  assert.ok(draft.document.issues.some(issue=>issue.severity==='error'&&issue.code==='MEASURE_OVERFULL'));
  assert.equal(draft.document.xml,overfull);
  assert.equal(draft.cost,input.cost);
  assert.deepEqual(draft.usage,input.usage);
  assert.equal(JSON.stringify(input),before);
});
test('a draft request still refuses notation the editor cannot faithfully represent',async()=>{
  const complex=xml.replace('<type>whole</type>','<type>whole</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
  const result=(await helper())(source(),{xml:complex,warnings:[]},{reviewDraft:true});
  assert.equal(result.score,null);
  assert.ok(result.editorIssue);
  assert.equal(result.document.xml,complex);
});
