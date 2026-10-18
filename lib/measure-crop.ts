export type NormalizedSourceRegion = { x: number; y: number; width: number; height: number };
export type SourceImageSize = { width: number; height: number };
export type SourcePixelRegion = { x: number; y: number; width: number; height: number };
export type SourceImageCrop = { file: File; width: number; height: number; scale: number; region: NormalizedSourceRegion };

/** Decode the original once and copy the chosen source pixels without downscaling. */
export async function cropSourceImage(file: File, region: NormalizedSourceRegion, options: { enlargeSmall?: boolean } = {}): Promise<SourceImageCrop> {
  const source = await normalizeImageFile(file);
  const image = await createImageBitmap(source);
  let canvas: HTMLCanvasElement | undefined;
  try {
    const pixels = sourceRegionToPixels(region, image);
    const scale = options.enlargeSmall && Math.max(pixels.width, pixels.height) < 512 ? 4 : 1;
    const width = pixels.width * scale, height = pixels.height * scale;
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('브라우저에서 원본 이미지를 자를 수 없습니다.');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(image, pixels.x, pixels.y, pixels.width, pixels.height, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(result => result ? resolve(result) : reject(new Error('선택한 영역의 PNG 파일을 만들지 못했습니다.')), 'image/png');
    });
    if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES) throw new Error('선택한 영역의 PNG는 10MB 이하이어야 합니다. 더 작은 영역을 표시해 주세요.');
    const stem = source.name.replace(/\.[^.]+$/, '') || '악보';
    return { file: new File([blob], `${stem}-region.png`, { type: 'image/png' }), width, height, scale, region: { ...region } };
  } finally {
    image.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

/** Coordinates refer to the uploaded image, never to a newly rendered score. */
export function sourceRegionToPixels(region: NormalizedSourceRegion, size: SourceImageSize): SourcePixelRegion {
  if (![size.width, size.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 32_768)
    || size.width * size.height > 64_000_000) throw new Error('원본 이미지 크기가 너무 크거나 올바르지 않습니다.');
  const { x, y, width, height } = region;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > 1 + 1e-12 || y + height > 1 + 1e-12) throw new Error('원본 이미지 안에 자를 영역을 표시해 주세요. 범위를 벗어날 수 없습니다.');
  if (width * height >= .98) throw new Error('전체 페이지 대신 수정할 일부 마디만 표시해 주세요.');
  // Avoid an extra pixel caused solely by e.g. (.2 + .1) * 6000.
  const left = Math.floor(x * size.width + 1e-9);
  const top = Math.floor(y * size.height + 1e-9);
  const right = Math.min(size.width, Math.ceil((x + width) * size.width - 1e-9));
  const bottom = Math.min(size.height, Math.ceil((y + height) * size.height - 1e-9));
  const pixels = { x: left, y: top, width: right - left, height: bottom - top };
  if (pixels.width < 24 || pixels.height < 24 || pixels.width * pixels.height < 1024) {
    throw new Error('선택한 영역이 너무 작습니다. 음표와 오선이 보이도록 더 넓게 표시해 주세요.');
  }
  if (pixels.width > 16_384 || pixels.height > 16_384 || pixels.width * pixels.height > 16_000_000) {
    throw new Error('선택한 영역의 크기가 너무 큽니다. 수정할 마디를 나누어 표시해 주세요.');
  }
  return pixels;
}

/** Pointer capture can continue outside the image; clamp the drag to its edges. */
export function sourceRegionFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): NormalizedSourceRegion {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) throw new Error('선택 좌표를 확인할 수 없습니다.');
  const x1 = Math.max(0, Math.min(1, start.x)), x2 = Math.max(0, Math.min(1, end.x));
  const y1 = Math.max(0, Math.min(1, start.y)), y2 = Math.max(0, Math.min(1, end.y));
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
import { MAX_IMAGE_BYTES, normalizeImageFile } from './image-input.ts';

