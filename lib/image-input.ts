export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type ImageSelection = { file: File | null; notice: string | null };

/** Only file objects qualify; HTML and URL text never trigger a download. */
export function selectImageInput(files: ArrayLike<File> | Iterable<File>): ImageSelection {
  const images = Array.from(files).filter(file =>
    file.type === 'image/png' || file.type === 'image/jpeg' || /\.(png|jpe?g)$/i.test(file.name),
  );
  return {
    file: images[0] ?? null,
    notice: images.length > 1 ? '이미지 여러 장 중 첫 번째 한 장을 선택했습니다. 나머지는 한 장씩 올려 주세요.' : null,
  };
}

/** Detect bytes before browser decode; neither the extension nor MIME is proof. */
export async function normalizeImageFile(file: File): Promise<File> {
  if (file.size === 0) throw new Error('비어 있는 파일은 읽을 수 없습니다. PNG 또는 JPG 이미지를 선택해 주세요.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('이미지는 10MB 이하로 올려 주세요.');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
  const jpeg = header.length >= 4 && header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (!png && !jpeg) throw new Error('실제 PNG 또는 JPG 이미지인지 확인해 주세요.');
  const type = png ? 'image/png' : 'image/jpeg';
  const extension = png ? 'png' : 'jpg';
  const stem = file.name.replace(/\.[^.]+$/, '').trim() || '악보';
  const name = `${stem}.${extension}`;
  return file.type === type && file.name === name ? file : new File([file], name, { type, lastModified: file.lastModified });
}
