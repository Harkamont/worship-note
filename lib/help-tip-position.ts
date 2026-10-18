type Anchor = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };
type Viewport = Size & { left?: number; top?: number };
export type HelpTipPosition = { left: number; top: number; maxWidth: number; maxHeight: number; placement: 'above' | 'below' };

/** Fixed-position coordinates also work inside a native dialog's top layer. */
export function positionHelpTip(anchor: Anchor, content: Size, viewport: Viewport): HelpTipPosition {
  const padding = 12;
  const gap = 8;
  const originLeft = viewport.left ?? 0;
  const originTop = viewport.top ?? 0;
  const maxWidth = Math.max(1, Math.min(308, viewport.width - padding * 2));
  const maxHeight = Math.max(1, viewport.height - padding * 2);
  const width = Math.min(content.width, maxWidth);
  const height = Math.min(content.height, maxHeight);
  const roomBelow = originTop + viewport.height - padding - anchor.bottom - gap;
  const roomAbove = anchor.top - originTop - padding - gap;
  const placement = roomBelow >= height || roomBelow >= roomAbove ? 'below' : 'above';
  const minimumLeft = originLeft + padding;
  const minimumTop = originTop + padding;
  const left = Math.min(Math.max((anchor.left + anchor.right - width) / 2, minimumLeft), Math.max(minimumLeft, originLeft + viewport.width - padding - width));
  const wantedTop = placement === 'below' ? anchor.bottom + gap : anchor.top - height - gap;
  const top = Math.min(Math.max(wantedTop, minimumTop), Math.max(minimumTop, originTop + viewport.height - padding - height));
  return { left, top, maxWidth, maxHeight, placement };
}
