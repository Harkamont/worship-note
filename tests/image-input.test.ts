import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_IMAGE_BYTES, normalizeImageFile, selectImageInput } from '../lib/image-input.ts';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0]);

test('a PNG with a blank MIME type is normalized from its bytes', async () => {
  const input = new File([png], '주일 악보.PNG', { lastModified: 123 });
  const output = await normalizeImageFile(input);
  assert.equal(output.type, 'image/png');
  assert.equal(output.name, '주일 악보.png');
  assert.equal(output.lastModified, 123);
  assert.deepEqual(new Uint8Array(await output.arrayBuffer()), png);
});

test('a renamed JPEG gets its actual MIME and extension without changing its bytes', async () => {
  const output = await normalizeImageFile(new File([jpeg], '찬송가.png', { type: 'image/png' }));
  assert.equal(output.type, 'image/jpeg');
  assert.equal(output.name, '찬송가.jpg');
  assert.deepEqual(new Uint8Array(await output.arrayBuffer()), jpeg);
});

test('PNG content declared as JPEG or a download gets its canonical type and name', async () => {
  for (const input of [
    new File([png], '원본.jpg', { type: 'image/jpeg' }),
    new File([png], '악보.download', { type: 'application/octet-stream' }),
    new File([png], '', { type: '' }),
  ]) {
    const output = await normalizeImageFile(input);
    assert.equal(output.type, 'image/png');
    assert.match(output.name, /\.png$/);
    assert.ok(output.name.length > 4);
  }
});

test('forged image types, empty files and incomplete signatures are rejected', async () => {
  for (const input of [
    new File(['<html>not an image</html>'], '악보.png', { type: 'image/png' }),
    new File(['%PDF-1.7'], '악보.jpg', { type: 'image/jpeg' }),
    new File([], 'empty.png', { type: 'image/png' }),
    new File([png.slice(0, 7)], 'short.png', { type: 'image/png' }),
    new File([jpeg.slice(0, 3)], 'short.jpg', { type: 'image/jpeg' }),
  ]) await assert.rejects(normalizeImageFile(input), /PNG|JPG|비어/);
});

test('oversized images are rejected before any file bytes are read', async () => {
  const input = new File([png], 'huge.png', { type: 'image/png' });
  Object.defineProperty(input, 'size', { value: MAX_IMAGE_BYTES + 1 });
  input.slice = () => { assert.fail('the size limit must run before reading bytes'); };
  await assert.rejects(normalizeImageFile(input), /10MB/);
});

test('normalization reads only the header before leaving decode to the browser', async () => {
  const input = new File([png], '악보.png', { type: 'image/png' });
  const slice = input.slice.bind(input);
  input.arrayBuffer = async () => { assert.fail('whole-file reads are unnecessary for MIME detection'); };
  input.slice = (start, end, type) => {
    assert.equal(start, 0);
    assert.ok(end !== undefined && end <= 12);
    return slice(start, end, type);
  };
  const output = await normalizeImageFile(input);
  assert.equal(output.type, 'image/png');
});

test('text, HTML, URLs and non-image files do not select an upload', () => {
  for (const files of [
    [],
    [new File(['text'], 'notes.txt', { type: 'text/plain' })],
    [new File(['<img src="https://example.test/score.png">'], 'page.html', { type: 'text/html' })],
    [new File(['https://example.test/score.png'], 'link.url', { type: 'text/uri-list' })],
    [new File(['PDF'], 'score.pdf', { type: 'application/pdf' })],
  ]) assert.deepEqual(selectImageInput(files), { file: null, notice: null });
});

test('selection keeps one image among non-image clipboard files', () => {
  const image = new File([png], '악보.png', { type: 'image/png' });
  assert.deepEqual(selectImageInput([new File(['text'], 'notes.txt', { type: 'text/plain' }), image]), { file: image, notice: null });
});

test('blank-MIME image names and PNG/JPEG clipboard MIME types are eligible for validation', () => {
  for (const image of [
    new File([png], '악보.PNG'),
    new File([jpeg], '악보.jpeg'),
    new File([png], 'clipboard', { type: 'image/png' }),
    new File([jpeg], 'clipboard', { type: 'image/jpeg' }),
  ]) assert.equal(selectImageInput([image]).file, image);
  assert.equal(selectImageInput([new File(['webp'], 'image.webp', { type: 'image/webp' })]).file, null);
});

test('multiple images select the first and return an explicit notice', () => {
  const first = new File([png], '첫째.png', { type: 'image/png' });
  const second = new File([jpeg], '둘째.jpg', { type: 'image/jpeg' });
  const result = selectImageInput([first, second]);
  assert.equal(result.file, first);
  assert.match(result.notice ?? '', /첫 번째|한 장/);
});

test('selection accepts the array-like FileList shape without requiring browser globals', () => {
  const image = new File([png], '악보.png', { type: 'image/png' });
  assert.equal(selectImageInput({ 0: image, length: 1 }).file, image);
});
