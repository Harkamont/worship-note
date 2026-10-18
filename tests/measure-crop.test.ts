import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { cropSourceImage, sourceRegionFromPoints, sourceRegionToPixels } from '../lib/measure-crop.ts';

test('source regions use the original image resolution and include fractional edge pixels', () => {
  assert.deepEqual(sourceRegionToPixels({ x: .1001, y: .2001, width: .1999, height: .0999 }, { width: 4000, height: 6000 }), {
    x: 400, y: 1200, width: 800, height: 600,
  });
});

test('a short full-width staff row is allowed without silently widening to a full page', () => {
  assert.deepEqual(sourceRegionToPixels({ x: 0, y: .3, width: 1, height: .15 }, { width: 907, height: 1280 }), {
    x: 0, y: 384, width: 907, height: 192,
  });
});

test('empty, outside and non-finite selections are rejected instead of using the whole page', () => {
  for (const region of [
    { x: 0, y: 0, width: 0, height: .1 },
    { x: -.01, y: 0, width: .5, height: .1 },
    { x: .8, y: 0, width: .3, height: .1 },
    { x: 0, y: .9, width: .5, height: .2 },
    { x: 0, y: 0, width: .5, height: -1 },
    { x: NaN, y: 0, width: .5, height: .1 },
    { x: 0, y: 0, width: Infinity, height: .1 },
  ]) assert.throws(() => sourceRegionToPixels(region, { width: 1000, height: 1400 }), /범위|영역/);
});

test('too-small selections and full-page equivalents require the user to select again', () => {
  assert.throws(() => sourceRegionToPixels({ x: 0, y: 0, width: .01, height: .1 }, { width: 1000, height: 1400 }), /작|24/);
  assert.throws(() => sourceRegionToPixels({ x: 0, y: 0, width: .024, height: .024 }, { width: 1000, height: 1000 }), /작|1024/);
  assert.throws(() => sourceRegionToPixels({ x: 0, y: 0, width: 1, height: 1 }, { width: 1000, height: 1400 }), /일부 마디/);
  assert.throws(() => sourceRegionToPixels({ x: 0, y: 0, width: 1, height: .98 }, { width: 1000, height: 1400 }), /일부 마디/);
});

test('unsafe dimensions and huge crops are rejected before a canvas allocation', () => {
  for (const size of [
    { width: 0, height: 1000 }, { width: 1.5, height: 1000 },
    { width: 1000, height: Infinity }, { width: 100_000, height: 1000 },
    { width: 10_000, height: 10_000 },
  ]) assert.throws(() => sourceRegionToPixels({ x: 0, y: 0, width: .5, height: .1 }, size), /크기|큽/);
  assert.throws(() => sourceRegionToPixels({ x: 0, y: 0, width: .9, height: .9 }, { width: 8000, height: 8000 }), /크기|큽/);
});

test('reverse drags and captured pointers outside the image produce bounded normalized rectangles', () => {
  assert.deepEqual(sourceRegionFromPoints({ x: .8, y: .6 }, { x: .2, y: .3 }), {
    x: .2, y: .3, width: .6000000000000001, height: .3,
  });
  assert.deepEqual(sourceRegionFromPoints({ x: .2, y: .3 }, { x: 2, y: -1 }), { x: .2, y: 0, width: .8, height: .3 });
  assert.throws(() => sourceRegionFromPoints({ x: NaN, y: 0 }, { x: .5, y: .5 }), /좌표/);
});

function cropBrowser(t: TestContext, options: { blob?: Blob | null; invalidSize?: boolean } = {}) {
  const draws: unknown[][] = [];
  let closed = false;
  const bitmap = { width: options.invalidSize ? 100_000 : 4000, height: 6000, close() { closed = true; } };
  const canvas = {
    width: 0, height: 0,
    getContext() { return { drawImage(...args: unknown[]) { draws.push(args); } }; },
    toBlob(done: (blob: Blob | null) => void, mime: string) {
      assert.equal(mime, 'image/png');
      done('blob' in options ? options.blob! : new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: mime }));
    },
  };
  for (const [name, value] of Object.entries({ createImageBitmap: async () => bitmap, document: { createElement(tag: string) { assert.equal(tag, 'canvas'); return canvas; } } })) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (prior) Object.defineProperty(globalThis, name, prior); else Reflect.deleteProperty(globalThis, name); });
  }
  return { bitmap, canvas, draws, closed: () => closed };
}

test('PNG and JPEG originals crop at native resolution and become lossless PNG files', async t => {
  const browser = cropBrowser(t);
  const region = { x: .1, y: .2, width: .25, height: .1 };
  for (const source of [
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'score.png', { type: 'image/png' }),
    new File([new Uint8Array([255, 216, 255, 224])], 'score.jpg', { type: 'image/jpeg' }),
  ]) {
    const result = await cropSourceImage(source, region);
    assert.equal(result.width, 1000);
    assert.equal(result.height, 600);
    assert.equal(result.file.type, 'image/png');
    assert.equal(result.file.name, 'score-region.png');
    assert.deepEqual(result.region, region);
    assert.deepEqual(browser.draws.at(-1), [browser.bitmap, 400, 1200, 1000, 600, 0, 0, 1000, 600]);
    assert.equal(browser.canvas.width, 0);
    assert.equal(browser.canvas.height, 0);
    assert.equal(browser.closed(), true);
  }
});

test('failed encoding and unsafe source size release image and canvas resources', async t => {
  const browser = cropBrowser(t, { blob: null });
  const source = new File([new Uint8Array([255, 216, 255, 224])], 'score.jpg', { type: 'image/jpeg' });
  await assert.rejects(cropSourceImage(source, { x: .1, y: .2, width: .25, height: .1 }), /PNG/);
  assert.equal(browser.closed(), true);
  assert.equal(browser.canvas.width, 0);
  assert.equal(browser.canvas.height, 0);
  browser.bitmap.width = 100_000;
  await assert.rejects(cropSourceImage(source, { x: .1, y: .2, width: .25, height: .1 }), /크기/);
  assert.equal(browser.draws.length, 1);
});

test('invalid file bytes and selections never produce a fallback image', async t => {
  const browser = cropBrowser(t);
  await assert.rejects(cropSourceImage(new File(['HTML'], 'score.jpg'), { x: .1, y: .2, width: .25, height: .1 }), /PNG|JPG/);
  await assert.rejects(cropSourceImage(new File([new Uint8Array([255, 216, 255, 224])], 'score.jpg'), { x: 0, y: 0, width: 1, height: 1 }), /일부 마디/);
  assert.equal(browser.draws.length, 0);
});

test('optional small-measure enlargement changes only output dimensions and keeps the original crop coordinates', async t => {
  const browser = cropBrowser(t);
  const region = { x: .1, y: .2, width: .025, height: .01 };
  const source = new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'score.png', { type: 'image/png' });
  const enlarged = await cropSourceImage(source, region, { enlargeSmall: true });
  assert.equal(enlarged.width, 400); assert.equal(enlarged.height, 240); assert.equal(enlarged.scale, 4);
  assert.deepEqual(browser.draws.at(-1), [browser.bitmap,400,1200,100,60,0,0,400,240]);
  const native = await cropSourceImage(source, region, { enlargeSmall: false });
  assert.equal(native.width,100); assert.equal(native.height,60); assert.equal(native.scale,1);
  const large = await cropSourceImage(source, {x:.1,y:.2,width:.25,height:.1}, {enlargeSmall:true});
  assert.equal(large.width,1000); assert.equal(large.height,600); assert.equal(large.scale,1);
});
