import test from 'node:test';
import assert from 'node:assert/strict';

import * as client from '../lib/local-text-ocr-client.ts';

const draft = {
  version: 1 as const, engine: 'local', elapsedMs: 120, cost: 0 as const,
  image: { width: 1000, height: 1400 }, warnings: [],
  systems: [{ index: 1, top: 200, bottom: 240,
    lyrics: [{ text: '첫째 절', y: 280 }, { text: '둘째 절', y: 310 }],
    chords: [{ text: 'E/G#', x: 300, y: 175 }, { text: 'E', x: 100, y: 176 }, { text: 'C#m7', x: 100, y: 145 }, { text: 'F#7', x: 300, y: 146 }],
  }],
};
const file = new File(['image'], 'sample.png', { type: 'image/png' });

test('editable text preserves printed lyric rows and alternative chord rows', () => {
  const systems = client.toEditableTextSystems(draft);
  assert.equal(systems[0].lyrics, '첫째 절\n둘째 절');
  assert.equal(systems[0].chords, 'C#m7  F#7\nE  E/G#');
  assert.deepEqual(draft.systems[0].chords.map(chord => chord.text), ['E/G#', 'E', 'C#m7', 'F#7']);
  systems[0].lyrics = '사용자가 고친 첫째 절\n둘째 절';
  assert.match(client.localTextDownload(systems), /사용자가 고친 첫째 절\n둘째 절/);
  assert.match(client.localTextDownload(systems), /C#m7  F#7\nE  E\/G#/);
});

test('local text request sends only the image and shares the abort signal', async () => {
  const controller = new AbortController();
  const data = await client.requestLocalTextDraft(file, { signal: controller.signal, fetcher: async (url, init) => {
    assert.equal(url, '/api/text-ocr'); assert.equal(init?.method, 'POST');
    assert.equal(init?.signal, controller.signal);
    assert.deepEqual([...(init?.body as FormData).keys()], ['image']);
    return Response.json(draft);
  }});
  assert.deepEqual(data, draft); assert.equal('score' in data, false);
  controller.abort();
  await assert.rejects(client.requestLocalTextDraft(file, { signal: controller.signal, fetcher: async () => { throw Error('must not dispatch'); }}), error => error instanceof Error && error.name === 'AbortError');
});

test('local text surfaces service errors and rejects a paid or malformed draft', async () => {
  await assert.rejects(client.requestLocalTextDraft(file, { fetcher: async () => Response.json({error:{message:'연결을 확인해 주세요.'}}, {status:503}) }), /연결을 확인해 주세요/);
  for (const output of [{...draft,cost:1},{...draft,version:2}, {score:{}}]) {
    await assert.rejects(client.requestLocalTextDraft(file, { fetcher: async () => Response.json(output) }), /텍스트 초안/);
  }
});

test('downloaded text keeps the source-specific uncertainty warnings', () => {
  const systems = client.toEditableTextSystems(draft);
  const output = client.localTextDownload(systems, ['2번째 줄의 코드행을 원본과 확인해 주세요.']);
  assert.match(output, /확인할 내용/);
  assert.match(output, /2번째 줄의 코드행을 원본과 확인해 주세요\./);
});

test('cancelling while the response is read never returns the completed draft', async () => {
  const controller = new AbortController();
  const response = Response.json(draft);
  response.json = async () => { controller.abort(); return draft; };
  await assert.rejects(client.requestLocalTextDraft(file, { signal: controller.signal, fetcher: async () => response }), error => error instanceof Error && error.name === 'AbortError');
});

test('superscript-height offsets stay in one chord row while the alternative row stays separate', () => {
  const source = structuredClone(draft);
  source.systems[0].chords = [
    { text: 'D/E', x: 300, y: 184 },
    { text: 'E', x: 100, y: 175 },
    { text: 'C#m7', x: 100, y: 145 },
    { text: 'F#7', x: 300, y: 146 },
  ];
  assert.equal(source.systems[0].bottom - source.systems[0].top, 40);
  assert.equal(client.toEditableTextSystems(source)[0].chords, 'C#m7  F#7\nE  D/E');
});

test('local text image bounds accept 4MP and 2500px limits and reject invalid dimensions', () => {
  assert.equal(typeof client.localTextImageSupported, 'function', 'local image size check is not implemented');
  for (const [width, height] of [[2000, 2000], [2500, 1600], [1600, 2500], [1, 2500]]) {
    assert.equal(client.localTextImageSupported(width, height), true, `${width}x${height}`);
  }
  for (const [width, height] of [[2500, 1601], [2001, 2000], [2501, 100], [100, 2501], [0, 100], [100, 0], [-1, 100], [NaN, 100], [100, NaN], [Infinity, 100]]) {
    assert.equal(client.localTextImageSupported(width, height), false, `${width}x${height}`);
  }
});
