import assert from 'node:assert/strict';
import test from 'node:test';
import { handleOmrDocumentRequest, handleOmrRequest } from '../lib/omr.ts';
import type { MusicXMLRecognitionResult } from '../lib/recognition.ts';

const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const environment = { OMR_BASE_URL: 'http://127.0.0.1:3101', OMR_AUTH_TOKEN: 'test-private-companion-token' };
const attrs = '<attributes><divisions>3</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const tuplet = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>';
const wrap = (measures: string) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
const xml = wrap(`<measure number="1">${attrs}${tuplet.repeat(12)}</measure>`);
function request(origin = 'http://localhost:5173', signal?: AbortSignal, extra = false) {
  const form = new FormData(); form.append('image', new Blob([png], { type: 'image/png' }), 'score.png');
  if (extra) form.append('musicxml', '<unsafe/>');
  return new Request('http://localhost:5173/api/omr-xml', { method: 'POST', headers: { origin }, body: form, signal });
}

test('raw OMR bridge preserves tuplets and returns a review even when the simple editor rejects them', async () => {
  let calls = 0;
  const response = await handleOmrDocumentRequest(request(), environment, async (url, init) => {
    calls++; assert.equal(url, 'http://127.0.0.1:3101/recognize');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${environment.OMR_AUTH_TOKEN}`);
    assert.equal(init?.redirect, 'manual');
    return new Response(xml);
  });
  assert.equal(response.status, 200); assert.equal(calls, 1);
  const data = await response.json() as MusicXMLRecognitionResult;
  assert.equal(data.document.xml, xml); assert.equal(data.document.noteCount, 12);
  assert.equal(data.score, null); assert.ok(data.editorIssue); assert.equal(data.model, 'HOMR');
  assert.equal(data.provider, 'local-omr'); assert.equal(data.cost, 0); assert.equal(data.usage, null);
  assert.equal(JSON.stringify(data).includes(environment.OMR_AUTH_TOKEN), false);
  assert.equal((await handleOmrRequest(request(), environment, async () => new Response(xml))).status, 502);
});

test('raw OMR retains pickups, key changes and parallel voices instead of padding or flattening them', async () => {
  const changed = wrap(`<measure number="0" implicit="yes">${attrs}${tuplet.repeat(3)}</measure><measure number="1"><attributes><key><fifths>1</fifths></key></attributes>${tuplet.repeat(12)}<backup><duration>12</duration></backup>${tuplet.replace('<voice>1</voice>', '<voice>2</voice>').repeat(12)}</measure>`);
  const response = await handleOmrDocumentRequest(request(), environment, async () => new Response(changed));
  const data = await response.json() as MusicXMLRecognitionResult;
  assert.equal(response.status, 200); assert.equal(data.document.xml, changed);
  assert.equal(data.document.parts[0].measures[0].implicit, true);
  assert.deepEqual(data.document.parts[0].voiceIds, ['1', '2']); assert.equal(data.score, null);
});

test('raw OMR also offers a strict optional Score while retaining the exact BOM and source XML', async () => {
  const source = '\uFEFF' + wrap(`<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><type>whole</type></note></measure>`);
  const response = await handleOmrDocumentRequest(request(), environment, async () => new Response(source));
  const data = await response.json() as MusicXMLRecognitionResult;
  assert.equal(response.status, 200); assert.equal(data.document.xml, source); assert.ok(data.score);
  assert.equal(data.editorIssue, null); assert.equal(data.score.sections[0].measures[0].notes[0].pitch, 'C4');
  assert.ok(data.document.issues.some(issue => issue.code === 'TEXT_ANNOTATION_PENDING'));
});

test('raw OMR shares origin, configuration, multipart, signature and response-size safeguards', async () => {
  let calls = 0; const never = async () => { calls++; return new Response(xml); };
  assert.equal((await handleOmrDocumentRequest(request('https://evil.example'), environment, never)).status, 403);
  assert.equal((await handleOmrDocumentRequest(request(), {}, never)).status, 503);
  assert.equal((await handleOmrDocumentRequest(request(undefined, undefined, true), environment, never)).status, 400);
  assert.equal(calls, 0);
  assert.equal((await handleOmrDocumentRequest(request(), environment, async () => new Response('invalid XML'))).status, 502);
  assert.equal((await handleOmrDocumentRequest(request(), environment, async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)))).status, 502);
  let redirect: RequestRedirect | undefined;
  assert.equal((await handleOmrDocumentRequest(request(), environment, async (_url, init) => { redirect = init?.redirect; return new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid' } }); })).status, 502);
  assert.equal(redirect, 'manual');
});

test('raw OMR cancellation releases the shared request slot without waiting for stalled stream cleanup', async () => {
  const controller = new AbortController(); let cancelled = false; let markReading: () => void = () => {};
  const reading = new Promise<void>(resolve => { markReading = resolve; });
  const pending = handleOmrDocumentRequest(request(undefined, controller.signal), environment, async () => new Response(new ReadableStream<Uint8Array>({
    pull() { markReading(); }, cancel() { cancelled = true; return new Promise<void>(() => {}); },
  }, { highWaterMark: 0 })));
  await reading;
  assert.equal((await handleOmrRequest(request(), environment, async () => new Response(xml))).status, 429);
  controller.abort(); assert.equal((await pending).status, 499); assert.equal(cancelled, true);
  assert.equal((await handleOmrDocumentRequest(request(), environment, async () => new Response(xml))).status, 200);
});

test('the shared 75-second OMR budget releases a stalled fetch and accepts a later request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let markStarted: () => void = () => {};
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const pending = handleOmrDocumentRequest(request(), environment, async () => { markStarted(); return new Promise<Response>(() => {}); });
  await started; t.mock.timers.tick(75_000);
  assert.equal((await pending).status, 504);
  assert.equal((await handleOmrDocumentRequest(request(), environment, async () => new Response(xml))).status, 200);
});
