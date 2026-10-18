import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeMusicXML, recognizeHybridMusicXML, MusicXMLHybridError, reviewMusicXMLFile } from '../lib/musicxml-client.ts';
import { createSampleScore } from '../lib/sample.ts';
import { strToU8, zipSync } from 'fflate';
import { listMusicXMLMelodySources } from '../lib/musicxml-melody.ts';

const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'sample.png', { type: 'image/png' });
const xml = '<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>한 곡</work-title></work><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><lyric number="1"><text>주</text></lyric></note></measure></part></score-partwise>';
const result = () => ({ document: { xml }, score: null, editorIssue: '여러 성부는 원본 XML로 확인해 주세요.', model: 'vision-model', provider: 'openai-compatible', elapsedMs: 100, usage: null, cost: 0.02 });
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

test('direct XML makes one multipart request and retains the original XML separately from optional Score', async () => {
  let calls = 0;
  const source = result();
  const score = createSampleScore();
  const output = await recognizeMusicXML(file, { fetcher: async (url, init) => {
    calls++; assert.equal(url, '/api/recognize-xml'); assert.equal(init?.method, 'POST');
    const form = init!.body as FormData;
    assert.deepEqual([...form.keys()], ['image']); assert.equal((form.get('image') as File).name, file.name);
    return Response.json({ ...source, score, editorIssue: null });
  } });
  assert.equal(calls, 1); assert.equal(output.document.xml, xml); assert.equal(output.document.noteCount, 1);
  assert.deepEqual(output.score, score); assert.equal(output.cost, 0.02);
});

test('server errors are presented and non-JSON failures are normalized without leaking raw text', async () => {
  await assert.rejects(recognizeMusicXML(file, { fetcher: async () => Response.json({ error: { code: 'AI_SERVICE_BUSY', message: '잠시 후 다시 시도해 주세요.' } }, { status: 503 }) }), /잠시 후/);
  await assert.rejects(recognizeMusicXML(file, { fetcher: async () => new Response('PRIVATE upstream diagnostic', { status: 502 }) }), error => error instanceof Error && !error.message.includes('PRIVATE') && /응답/.test(error.message));
});

test('invalid XML, Score and result metadata are rejected', async () => {
  for (const source of [
    { ...result(), document: { xml: '<html><script>bad()</script></html>' } },
    { ...result(), score: { version: 1 } },
    { ...result(), cost: -1 },
    { ...result(), elapsedMs: '100' },
    { ...result(), usage: { inputTokens: -1 } },
  ]) await assert.rejects(recognizeMusicXML(file, { fetcher: async () => Response.json(source) }));
});

test('long editor incompatibility diagnostics preserve the original XML review and optional null Score', async () => {
  const editorIssue = Array.from({ length: 128 }, (_, index) => `${index + 1}마디: 편집기가 지원하지 않는 음표 길이와 성부를 원본에서 확인해 주세요.`).join('\n');
  assert.ok(editorIssue.length > 1000);
  const output = await recognizeMusicXML(file, { fetcher: async () => Response.json({ ...result(), editorIssue }) });
  assert.equal(output.document.xml, xml); assert.equal(output.score, null); assert.equal(output.editorIssue, editorIssue);
  await assert.rejects(recognizeMusicXML(file, { fetcher: async () => Response.json({ ...result(), editorIssue: '한'.repeat(22_000) }) }));
});

test('cancellation before sending never starts a paid request', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(recognizeMusicXML(file, { signal: controller.signal, fetcher: async () => { calls++; return Response.json(result()); } }), isAbort);
  assert.equal(calls, 0);
});

test('cancellation settles even when an injected fetch never finishes', async () => {
  const controller = new AbortController();
  const pending = recognizeMusicXML(file, { signal: controller.signal, fetcher: async () => new Promise<Response>(() => {}) });
  controller.abort(); await assert.rejects(pending, isAbort);
});

test('cancellation while reading a stalled response body settles and cancels the reader', async () => {
  const controller = new AbortController(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => {}); } });
  const pending = recognizeMusicXML(file, { signal: controller.signal, fetcher: async () => new Response(body) });
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
  await assert.rejects(pending, isAbort); assert.equal(cancelled, true);
});

test('a cancellation just after a response arrives prevents applying the result', async () => {
  const controller = new AbortController();
  await assert.rejects(recognizeMusicXML(file, { signal: controller.signal, fetcher: async () => { controller.abort(); return Response.json(result()); } }), isAbort);
});

test('oversized responses are stopped before JSON parsing', async () => {
  await assert.rejects(recognizeMusicXML(file, { fetcher: async () => new Response('x'.repeat(8 * 1024 * 1024 + 1)) }), /너무 큽니다/);
});

test('local XML import preserves the raw document and returns an optional Score for explicit import without AI', async () => {
  const output = await reviewMusicXMLFile(new File([xml], 'edited.musicxml'));
  assert.equal(output.document.xml, xml); assert.ok(output.score); assert.equal(output.score.source, 'manual');
  assert.equal(output.provider, 'local-file'); assert.equal(output.usage, null); assert.equal(output.cost, undefined);
  const withBOM = await reviewMusicXMLFile(new File(['\uFEFF' + xml], 'bom.xml'));
  assert.equal(withBOM.document.xml, '\uFEFF' + xml);
});

test('local editor-incompatible XML keeps the review instead of dropping its original source', async () => {
  const changed = xml.replace('<duration>4</duration>', '<duration>3</duration>');
  const output = await reviewMusicXMLFile(new File([changed], 'edited.xml'));
  assert.equal(output.document.xml, changed); assert.equal(output.score, null); assert.ok(output.editorIssue);
  assert.ok(output.document.issues.some(issue => issue.code === 'MEASURE_UNDERFULL'));
});

test('local XML reader bounds files, rejects malformed XML and respects cancellation', async () => {
  await assert.rejects(reviewMusicXMLFile(new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'large.xml')), /2MB/);
  await assert.rejects(reviewMusicXMLFile(new File(['<score-partwise>'], 'bad.xml')));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reviewMusicXMLFile(new File([xml], 'edited.xml'), { signal: controller.signal }), isAbort);
});

function compressedXML(source: string, path = 'score.musicxml') {
  const manifest = `<container><rootfiles><rootfile full-path="${path}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
  return zipSync({ 'META-INF/container.xml': strToU8(manifest), [path]: strToU8(source) });
}

test('local compressed XML keeps multivoice source XML available for explicit melody selection', async () => {
  const alto = '<backup><duration>4</duration></backup><note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type></note>';
  const polyphonic = xml.replace('</measure>', alto + '</measure>');
  const output = await reviewMusicXMLFile(new File([compressedXML(polyphonic)], 'choir.MXL'));
  assert.equal(output.document.xml, polyphonic);
  assert.equal(output.document.noteCount, 2);
  assert.deepEqual(output.document.parts[0].voiceIds, ['1', '2']);
  assert.equal(output.score, null);
  assert.ok(output.editorIssue);
  assert.deepEqual(listMusicXMLMelodySources(output.document.xml).map(source => source.voice), ['*', '1', '2']);
  assert.equal(output.provider, 'local-file');
  assert.equal(output.usage, null);
  assert.equal(output.cost, undefined);
});

test('local compressed XML preserves a rootfile BOM and can return a directly editable score', async () => {
  const source = '\uFEFF' + xml;
  const output = await reviewMusicXMLFile(new File([compressedXML(source)], 'bom.mxl'));
  assert.equal(output.document.xml, source);
  assert.ok(output.score);
  assert.equal(output.score.source, 'manual');
});

test('local compressed XML review rejects unsafe archives and bounds compressed and expanded sizes', async () => {
  await assert.rejects(reviewMusicXMLFile(new File([compressedXML(xml, '../outside.xml')], 'unsafe.mxl')), /파일 이름|지정|이름/);
  await assert.rejects(reviewMusicXMLFile(new File(['PKbroken'], 'broken.mxl')));
  await assert.rejects(reviewMusicXMLFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.mxl')), /10MB/);
  await assert.rejects(reviewMusicXMLFile(new File([compressedXML('x'.repeat(2 * 1024 * 1024 + 1))], 'large-root.mxl')), /2MB/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reviewMusicXMLFile(new File([compressedXML(xml)], 'cancelled.mxl'), { signal: controller.signal }), isAbort);
});

test('XML hybrid sends raw OMR XML rather than a simple Score and combines reported time and cost', async () => {
  const calls: string[] = []; const drafts: string[] = [];
  const output = await recognizeHybridMusicXML(file, { onDraft: draft => drafts.push(draft.document.xml), fetcher: async (url, init) => {
    calls.push(url); const body = init!.body as FormData;
    if (url === '/api/omr-xml') { assert.deepEqual([...body.keys()], ['image']); return Response.json({ ...result(), model: 'HOMR', provider: 'local-omr', elapsedMs: 50, cost: 0 }); }
    assert.equal(url, '/api/annotate-xml'); assert.deepEqual([...body.keys()], ['image', 'musicxml']); assert.equal(body.get('musicxml'), xml);
    return Response.json({ ...result(), document: { xml, issues: [{ severity: 'warning', code: 'AI_TEXT_UNCERTAINTY', message: '가사 한 음절을 확인해 주세요.' }] } });
  } });
  assert.deepEqual(calls, ['/api/omr-xml', '/api/annotate-xml']); assert.deepEqual(drafts, [xml]);
  assert.equal(output.document.xml, xml); assert.equal(output.score, null); assert.equal(output.elapsedMs, 150); assert.equal(output.cost, 0.02);
  assert.equal(output.model, 'HOMR + vision-model'); assert.ok(output.document.issues.some(issue => issue.code === 'AI_TEXT_UNCERTAINTY'));
});

test('cancelling between XML hybrid stages prevents the paid annotation request', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(recognizeHybridMusicXML(file, { signal: controller.signal, onDraft: () => controller.abort(), fetcher: async () => { calls++; return Response.json({ ...result(), model: 'HOMR', provider: 'local-omr', cost: 0 }); } }), error => error instanceof MusicXMLHybridError && error.name === 'AbortError' && error.draft.document.xml === xml);
  assert.equal(calls, 1);
});

test('annotation failure exposes the retained HOMR draft and never retries either stage automatically', async () => {
  let calls = 0;
  await assert.rejects(recognizeHybridMusicXML(file, { fetcher: async url => { calls++; return url === '/api/omr-xml' ? Response.json({ ...result(), model: 'HOMR', provider: 'local-omr', cost: 0 }) : Response.json({ error: { message: 'AI 크레딧을 확인해 주세요.' } }, { status: 429 }); } }), error => error instanceof MusicXMLHybridError && /크레딧/.test(error.message) && error.draft.document.xml === xml && error.draft.model === 'HOMR');
  assert.equal(calls, 2);
});

test('a failed XML OMR stage prevents AI and missing annotation cost stays unknown', async () => {
  let calls = 0;
  await assert.rejects(recognizeHybridMusicXML(file, { fetcher: async () => { calls++; return Response.json({ error: { message: 'OMR 원본 확인' } }, { status: 502 }); } }), /OMR 원본/);
  assert.equal(calls, 1);
  const output = await recognizeHybridMusicXML(file, { fetcher: async url => { const data = result(); return Response.json(url === '/api/omr-xml' ? { ...data, model: 'HOMR', provider: 'local-omr', cost: 0 } : { ...data, cost: undefined }); } });
  assert.equal(output.cost, undefined);
});

test('local XML recognition uses only the local OMR endpoint and retains multi-part XML without any AI stage', async () => {
  const client = await import('../lib/musicxml-client.ts');
  assert.ok('recognizeOMRMusicXML' in client, 'the free XML-only entry point must exist');
  const fn = (client as typeof client & { recognizeOMRMusicXML: typeof recognizeMusicXML }).recognizeOMRMusicXML;
  const calls: string[] = [];
  const output = await fn(file, { fetcher: async (url, init) => {
    calls.push(url); assert.equal(url, '/api/omr-xml');
    assert.deepEqual([...(init!.body as FormData).keys()], ['image']);
    return Response.json({ ...result(), model: 'HOMR', provider: 'local-omr', cost: 0 });
  } });
  assert.deepEqual(calls, ['/api/omr-xml']); assert.equal(output.cost, 0); assert.equal(output.document.xml, xml);
});

test('measure repair rejects changes outside the selected bars even with matching receipt metadata', async () => {
  const { repairMusicXMLMeasures } = await import('../lib/musicxml-client.ts');
  const twoBars = xml.replace('</part>', '<measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>');
  const selection = { partId: 'P1', startMeasure: 1, endMeasure: 1 };
  const forged = twoBars.replace('<step>D</step>', '<step>G</step>');
  await assert.rejects(repairMusicXMLMeasures(file, twoBars, selection, { fetcher: async () => Response.json({ ...result(), document: { xml: forged }, score: createSampleScore(), editorIssue: null, repair: { selection, originalXML: twoBars, changedMeasureNumbers: ['1'] } }) }));
});

test('measure repair derives the editor score from verified merged XML rather than trusting a supplied score', async () => {
  const { repairMusicXMLMeasures } = await import('../lib/musicxml-client.ts');
  const selection = { partId: 'P1', startMeasure: 1, endMeasure: 1 };
  const { applyMeasureRepair } = await import('../lib/musicxml-measure-repair.ts');
  const repaired = applyMeasureRepair(xml, selection, xml.replace('<work><work-title>한 곡</work-title></work>', '').replace('<step>C</step>', '<step>D</step>')).xml;
  const output = await repairMusicXMLMeasures(file, xml, selection, { fetcher: async () => Response.json({ ...result(), document: { xml: repaired }, score: createSampleScore(), editorIssue: null, repair: { selection, originalXML: xml, changedMeasureNumbers: ['1'] } }) });
  assert.equal(output.document.xml, repaired);
  assert.equal(output.score?.sections[0].measures[0].notes[0].pitch, 'D4');
  assert.equal(output.score?.sections[0].measures.length, 1);
});

test('measure repair preserves an exact BOM-bearing source snapshot through the request, receipt and verified candidate', async () => {
  const { repairMusicXMLMeasures } = await import('../lib/musicxml-client.ts');
  const { applyMeasureRepair } = await import('../lib/musicxml-measure-repair.ts');
  const original = '\uFEFF' + xml;
  const selection = { partId: 'P1', startMeasure: 1, endMeasure: 1 };
  const repaired = applyMeasureRepair(original, selection, xml.replace('<step>C</step>', '<step>D</step>')).xml;
  let calls = 0;
  const output = await repairMusicXMLMeasures(file, original, selection, { fetcher: async (url, init) => {
    calls++;
    assert.equal(url, '/api/repair-xml');
    assert.equal((init!.body as FormData).get('musicxml'), xml);
    return Response.json({ ...result(), document: { xml: repaired.slice(1) }, repair: { selection, originalXML: xml, changedMeasureNumbers: ['1'] } });
  } });
  assert.equal(calls, 1);
  assert.equal(output.repair.originalXML, original);
  assert.equal(output.document.xml, repaired);
  assert.ok(output.document.xml.startsWith('\uFEFF'));
  assert.equal(output.score?.sections[0].measures[0].notes[0].pitch, 'D4');
  assert.equal(output.cost, .02);
});
