import assert from 'node:assert/strict';
import test from 'node:test';
import * as api from '../lib/recognition.ts';
import type { MusicXMLRecognitionResult } from '../lib/recognition.ts';
import { recognizeMusicXML } from '../lib/musicxml-client.ts';

const env = { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_API_KEY: 'test-only-secret', AI_MODEL: 'old-model', AI_MUSICXML_MODEL: 'openai/gpt-6.1-sol', AI_MUSICXML_SERVICE_TIER: 'flex', AI_REASONING_ENABLED: 'false' };
const xml = '<score-partwise version="4.0"><work><work-title>검토</work-title></work><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type><lyric number="1"><syllabic>single</syllabic><text>주</text><extend type="start"/></lyric></note></measure></part></score-partwise>';
function request(origin: string | null = 'https://score.test', signal?: AbortSignal) {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0])], { type: 'image/png' }), 'song.png');
  return new Request('https://score.test/api/recognize-xml', { method: 'POST', headers: origin ? { origin } : {}, body: form, signal });
}
function upstream(content = xml, reason = 'stop') {
  return Response.json({ model: 'openai/gpt-6.1-sol', choices: [{ finish_reason: reason, message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 150, total_tokens: 250, cost: 0.001 } });
}
function handler() {
  assert.ok('handleMusicXMLRecognitionRequest' in api, 'direct XML handler must exist');
  return (api as typeof api & { handleMusicXMLRecognitionRequest: (request: Request, environment: typeof env, fetcher: (url: string, init?: RequestInit) => Promise<Response>) => Promise<Response> }).handleMusicXMLRecognitionRequest;
}

test('direct XML uses the exact model, mandatory reasoning and locked Flex without JSON mode', async () => {
  const response = await handler()(request(), env, async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-only-secret');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'openai/gpt-6.1-sol');
    assert.equal(body.response_format, undefined);
    assert.equal(body.stream, true);
    assert.equal(body.service_tier, 'flex');
    assert.deepEqual(body.provider, { only: ['openai/flex'], allow_fallbacks: false, require_parameters: true });
    assert.equal(body.reasoning.enabled, undefined);
    assert.equal(body.reasoning.effort, 'high');
    assert.equal(body.messages[1].content[1].image_url.detail, 'high');
    assert.match(body.messages[0].content, /syllabic/);
    assert.match(body.messages[0].content, /untrusted/i);
    return upstream();
  });
  assert.equal(response.status, 200);
  const result = await response.json() as MusicXMLRecognitionResult;
  assert.equal(result.document.xml, xml);
  assert.equal(result.score?.source, 'ai');
  assert.equal(result.editorIssue, null);
  assert.equal(result.cost, 0.001);
  assert.equal(JSON.stringify(result).includes('test-only-secret'), false);
});

test('editor-incompatible XML is preserved with review issues rather than thrown away', async () => {
  const changed = xml.replace('<note>', '<note><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
  const response = await handler()(request(), env, async () => upstream(changed));
  const result = await response.json() as MusicXMLRecognitionResult;
  assert.equal(response.status, 200);
  assert.equal(result.document.xml, changed);
  assert.equal(result.score, null);
  assert.match(result.editorIssue ?? '', /잇단음표|길이|구조/);
});

test('rejects malformed, fenced and truncated XML instead of inventing a score', async () => {
  for (const [content, reason] of [['<score-partwise>', 'stop'], ['```xml\n' + xml + '\n```', 'stop'], [xml, 'length']]) {
    const response = await handler()(request(), env, async () => upstream(content, reason));
    assert.equal(response.status, 502);
    const result = await response.json() as { error: { code: string } };
    assert.ok(['AI_INVALID_MUSICXML', 'AI_TRUNCATED'].includes(result.error.code));
  }
});

test('XML shares same-origin, upload and credential protections with other recognition', async () => {
  for (const origin of ['https://other.test', null]) {
    const response = await handler()(request(origin), env, async () => { assert.fail('cross-origin must not invoke AI'); });
    assert.equal(response.status, 403);
  }
});

test('a mid-stream provider failure is reported as a service interruption, never a score', async () => {
  const response = await handler()(request(), env, async () => new Response('data: {"error":{"code":502,"message":"private upstream detail"}}\n\ndata: [DONE]\n\n', { headers: { 'content-type':'text/event-stream' } }));
  assert.equal(response.status,502);
  const result=await response.json() as {error:{code:string}};
  assert.equal(result.error.code,'AI_STREAM_FAILED');
  assert.equal(JSON.stringify(result).includes('private upstream'),false);
});

test('long editor diagnostics are abbreviated before the real client receives the preserved XML', async()=>{
  const grace='<note><grace/><pitch><step>C</step><octave>4</octave></pitch><type>quarter</type></note>';
  const many=xml.replace('<note>',grace.repeat(1000)+'<note>');
  const response=await handler()(request(),env,async()=>upstream(many));
  assert.equal(response.status,200);
  const data=await response.clone().json() as MusicXMLRecognitionResult;
  assert.ok(new TextEncoder().encode(data.editorIssue??'').byteLength<64000);
  const client=await recognizeMusicXML(new File(['test'],'score.png',{type:'image/png'}),{fetcher:async()=>response});
  assert.equal(client.document.xml,many);
  assert.equal(client.score,null);
});
