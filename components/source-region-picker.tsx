'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { HelpTip } from '@/components/help-tip';
import { sourceRegionFromPoints, sourceRegionToPixels, type NormalizedSourceRegion, type SourceImageSize } from '@/lib/measure-crop';

export type SourceRegionPickerProps = {
  sourceUrl: string;
  value: NormalizedSourceRegion | null;
  onChange: (region: NormalizedSourceRegion | null) => void;
  disabled?: boolean;
};

const fields = [['x', '왼쪽'], ['y', '위쪽'], ['width', '너비'], ['height', '높이']] as const;

/** The user marks source pixels; selecting a rectangle does not identify bar numbers. */
export function SourceRegionPicker({ sourceUrl, value, onChange, disabled = false }: SourceRegionPickerProps) {
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState<(SourceImageSize & { url: string }) | null>(null);
  const [loadError, setLoadError] = useState(false);
  const size = loaded?.url === sourceUrl ? loaded : null;
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = image.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!disabled && start.current?.pointerId === event.pointerId) onChange(sourceRegionFromPoints(start.current, point(event)));
  };
  let notice = '원본에서 수정할 마디를 마우스나 손가락으로 끌어 표시해 주세요.';
  let invalid = false;
  if (value && size) {
    try {
      const pixels = sourceRegionToPixels(value, size);
      notice = `선택 영역 ${pixels.width} × ${pixels.height}px · 원본 면적의 ${(value.width * value.height * 100).toFixed(1)}%`;
    } catch (error) { notice = error instanceof Error ? error.message : '선택 영역을 확인해 주세요.'; invalid = true; }
  }

  return <div className="source-region-picker">
    <div className="help-heading"><span>원본에서 고칠 마디 선택</span><HelpTip helpKey="measureRepairImage" label="이미지 영역 선택"/></div>
    <div className={`source-region-stage ${disabled ? 'is-disabled' : ''}`}
      style={{ touchAction: disabled ? 'auto' : 'none' }}
      onPointerDown={event => {
        if (disabled || !size || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        start.current = { ...point(event), pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
        onChange(sourceRegionFromPoints(start.current, start.current));
      }}
      onPointerMove={move}
      onPointerUp={event => {
        if (start.current?.pointerId !== event.pointerId) return;
        move(event);
        start.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { start.current = null; }}
      onLostPointerCapture={() => { start.current = null; }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={image} src={sourceUrl} alt="수정할 마디를 표시할 원본 악보" draggable={false} className="block h-auto w-full select-none"
        onLoad={event => { setLoaded({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight, url: sourceUrl }); setLoadError(false); }}
        onError={() => { setLoaded(null); setLoadError(true); }} />
      {value && <div aria-hidden="true" className="source-region-selection"
        style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.width * 100}%`, height: `${value.height * 100}%` }} />}
    </div>
    <p role="status" className={`text-sm ${invalid || loadError ? 'text-destructive' : 'text-muted-foreground'}`}>{loadError ? '원본 이미지를 열지 못했습니다. 다시 올려 주세요.' : notice}</p>
    <details className="source-region-adjust"><summary>선택 영역 직접 조정</summary><fieldset disabled={disabled} className="flex flex-wrap items-end gap-2">
      <legend className="sr-only">선택 영역 조정 (원본 크기의 백분율)</legend>
      {fields.map(([field, label]) => <label key={field} className="space-y-1 text-xs">{label} (%)
        <input aria-label={`${label} (%)`} type="number" min={0} max={100} step={.1} value={value ? Number((value[field] * 100).toFixed(2)) : ''}
          onChange={event => { if (event.currentTarget.value !== '') onChange({ ...(value ?? { x: 0, y: 0, width: 0, height: 0 }), [field]: event.currentTarget.valueAsNumber / 100 }); }}
          className="block w-20 rounded-md border bg-background px-2 py-1.5 text-sm" />
      </label>)}
      <button type="button" disabled={!value} onClick={() => onChange(null)} className="rounded-md border px-3 py-1.5 text-sm">선택 지우기</button>
    </fieldset></details>
  </div>;
}
