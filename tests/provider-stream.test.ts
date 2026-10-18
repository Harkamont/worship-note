import assert from 'node:assert/strict';
import test from 'node:test';
const api = await import('../lib/provider-stream.ts').catch(() => null);
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (let i=0;i<bytes.length;i+=3) controller.enqueue(bytes.slice(i,i+3)); controller.close(); } }), { headers: { 'content-type':'text/event-stream' } });
}
function reader() { assert.ok(api,'SSE completion parser must exist'); return api.readChatCompletionStream; }
test('reassembles fragmented Korean XML with comments, reasoning, finish and usage frames',async()=>{
  const data=await reader()(response(': OPENROUTER PROCESSING\n\ndata: {"id":"gen-safe","choices":[{"delta":{"reasoning":"do not expose"}}]}\n\ndata: {"choices":[{"delta":{"content":"<text>주"}}]}\n\ndata: {"choices":[{"delta":{"content":"님</text>"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"cost":0.01}}\n\ndata: [DONE]\n\n'));
  assert.equal(data.choices[0].message.content,'<text>주님</text>');
  assert.equal(data.usage?.cost,0.01);
  assert.equal(data.id,'gen-safe');
  assert.equal(JSON.stringify(data).includes('do not expose'),false);
});
test('rejects errors, malformed frames and missing termination instead of accepting partial XML',async()=>{
  for(const text of ['data: {bad}\n\n','data: {"error":{"message":"secret upstream detail"}}\n\n','data: {"choices":[{"delta":{"content":"<note/>"}}]}\n\n']) await assert.rejects(reader()(response(text)));
});
test('aborting a stalled stream releases immediately even if cancel never settles',async()=>{
  const controller=new AbortController();
  const stalled=new Response(new ReadableStream({cancel(){return new Promise(()=>{});}}));
  const pending=reader()(stalled,{signal:controller.signal});controller.abort();
  await assert.rejects(pending);
});
test('bounds streamed bytes before accumulating the complete output',async()=>{
  await assert.rejects(reader()(response('data: '+JSON.stringify({choices:[{delta:{content:'x'.repeat(200)}}]})+'\n\n'),{maxBytes:100}),/크기|large|limit/);
});
test('transport framing does not consume the separately bounded MusicXML text allowance',async()=>{
  const frames=Array.from({length:50},()=>`data: ${JSON.stringify({id:'long-metadata'.repeat(20),choices:[{delta:{content:'주'}}]})}\n\n`).join('');
  const data=await reader()(response(frames+'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'),{maxBytes:50000,maxTextBytes:150});
  assert.equal(data.choices[0].message.content,'주'.repeat(50));
  await assert.rejects(reader()(response(frames),{maxBytes:50000,maxTextBytes:149}),/크기/);
});
