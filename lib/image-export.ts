// VexFlow 5 exports its font data only from this package-internal ESM module.
// Reusing the bundled data keeps both preview and exported PNG independent of a font CDN.
// @ts-expect-error VexFlow ships this module's declaration in build/types, not beside its ESM file.
import { Bravura } from '../node_modules/vexflow/build/esm/src/fonts/bravura.js';

const MAX_SIDE = 16_384;
const MAX_PIXELS = 32_000_000;

function safeFilename(filename: string): string {
  return filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 180) || 'score';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename(filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari may consume the URL after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(content: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

export async function downloadScorePNG(svg: SVGSVGElement, filename: string, scale = 2): Promise<void> {
  if (svg.getAttribute('data-render-ready') !== 'true') throw new Error('악보 표시가 끝나지 않았거나 오류가 있습니다. 내용을 확인한 뒤 다시 저장해 주세요.');
  const renderKey = svg.getAttribute('data-render-key');
  await document.fonts.ready;
  if (svg.getAttribute('data-render-ready') !== 'true' || svg.getAttribute('data-render-key') !== renderKey) {
    throw new Error('악보가 변경되었습니다. 표시가 끝난 뒤 다시 저장해 주세요.');
  }
  const viewBox = svg.viewBox.baseVal;
  const width = viewBox.width || svg.width.baseVal.value || svg.getBoundingClientRect().width;
  const height = viewBox.height || svg.height.baseVal.value || svg.getBoundingClientRect().height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('악보의 크기를 확인할 수 없습니다.');
  if (width > 100_000 || height > 100_000) throw new Error('악보가 너무 깁니다. 구간을 나누어 저장해 주세요.');
  const requestedScale = Number.isFinite(scale) ? Math.max(0.25, Math.min(4, scale)) : 2;
  const effectiveScale = Math.min(requestedScale, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
  const pixelWidth = Math.max(1, Math.floor(width * effectiveScale));
  const pixelHeight = Math.max(1, Math.floor(height * effectiveScale));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-export-ignore], script, foreignObject').forEach((node) => node.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${width} ${height}`);
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.background = '#ffffff';
  // SVG loaded as an Image has an isolated font set: embed the music font explicitly.
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `@font-face { font-family: 'Bravura'; src: url('${Bravura}') format('woff2'); font-weight: normal; font-style: normal; }`;
  clone.insertBefore(style, clone.firstChild);
  if (clone.querySelector('image, use[href^="http"], use[href^="//"]')) throw new Error('외부 이미지는 악보 내보내기에 사용할 수 없습니다.');
  const source = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('이미지 변환 시간이 초과되었습니다. 악보를 나누어 저장해 주세요.')), 15_000);
      image.onload = () => { window.clearTimeout(timeout); resolve(); };
      image.onerror = () => { window.clearTimeout(timeout); reject(new Error('악보 이미지를 만들지 못했습니다. 다시 시도해 주세요.')); };
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('브라우저에서 이미지 저장을 지원하지 않습니다.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pixelWidth, pixelHeight);
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG 파일을 만들지 못했습니다.')), 'image/png');
    });
    downloadBlob(blob, /\.png$/i.test(filename) ? filename : `${filename}.png`);
    canvas.width = 0;
    canvas.height = 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}
