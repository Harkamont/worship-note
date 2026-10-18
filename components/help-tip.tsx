'use client';

import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { helpContent, type HelpKey } from '@/lib/help-content.ts';
import { positionHelpTip, type HelpTipPosition } from '@/lib/help-tip-position.ts';

type HelpTipState = { open: boolean; hovered: boolean; focused: boolean; pinned: boolean };
type HelpTipEvent = 'pointer-enter' | 'pointer-leave' | 'focus' | 'blur' | 'toggle' | 'dismiss';
export const initialHelpTipState: HelpTipState = { open: false, hovered: false, focused: false, pinned: false };
export function helpTipReducer(state: HelpTipState, event: HelpTipEvent): HelpTipState {
  switch (event) {
    case 'pointer-enter': return { ...state, hovered: true, open: true };
    case 'pointer-leave': return { ...state, hovered: false, open: (state.focused || state.pinned) && state.open };
    case 'focus': return { ...state, focused: true, open: true };
    case 'blur': return { ...state, focused: false, pinned: false, open: state.hovered && state.open };
    case 'toggle': return { ...state, pinned: !state.pinned, open: !state.pinned };
    case 'dismiss': return { ...state, pinned: false, open: false };
  }
}

type ScrollMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number };
/** Navigation stays inside an open tooltip while focus remains on its button. */
export function helpTipScrollTarget(key: string, metrics: ScrollMetrics): number | null {
  const maximum = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const page = Math.max(40, Math.round(metrics.clientHeight * 0.9));
  const target = key === 'ArrowDown' ? metrics.scrollTop + 40 : key === 'ArrowUp' ? metrics.scrollTop - 40
    : key === 'PageDown' ? metrics.scrollTop + page : key === 'PageUp' ? metrics.scrollTop - page
      : key === 'Home' ? 0 : key === 'End' ? maximum : null;
  return target === null ? null : Math.min(maximum, Math.max(0, target));
}

type HelpTipProps = {
  helpKey: HelpKey;
  /** Use only when the surrounding field needs a different accessible name. */
  label?: string;
};

/** Place beside a heading or field label, never inside another button or label. */
export function HelpTip({ helpKey, label }: HelpTipProps) {
  const content = helpContent[helpKey];
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, dispatch] = useReducer(helpTipReducer, initialHelpTipState);
  const [position, setPosition] = useState<HelpTipPosition | null>(null);
  function clearLeaveTimer() {
    if (leaveTimer.current !== null) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
  }
  useEffect(() => () => { if (leaveTimer.current !== null) clearTimeout(leaveTimer.current); }, []);
  useLayoutEffect(() => {
    if (!state.open) return;
    function reposition() {
      if (!trigger.current || !popover.current) return;
      const view = window.visualViewport;
      const next = positionHelpTip(trigger.current.getBoundingClientRect(), popover.current.getBoundingClientRect(), {
        width: view?.width ?? window.innerWidth,
        height: view?.height ?? window.innerHeight,
        left: view?.offsetLeft ?? 0,
        top: view?.offsetTop ?? 0,
      });
      setPosition(previous => previous && previous.left === next.left && previous.top === next.top && previous.maxWidth === next.maxWidth && previous.maxHeight === next.maxHeight && previous.placement === next.placement ? previous : next);
    }
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) dispatch('dismiss');
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // Consume this Escape so it does not also close a containing native dialog.
      event.preventDefault(); event.stopPropagation(); dispatch('dismiss');
    }
    reposition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition);
    if (popover.current) observer?.observe(popover.current);
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', dismissOnEscape, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      observer?.disconnect();
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('keydown', dismissOnEscape, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
    };
  }, [state.open, helpKey, label]);

  return <span className="help-tip" ref={wrapper} onPointerEnter={event => { clearLeaveTimer(); if (event.pointerType !== 'touch') dispatch('pointer-enter'); }} onPointerLeave={event => { if (event.pointerType === 'touch') return; clearLeaveTimer(); leaveTimer.current = setTimeout(() => dispatch('pointer-leave'), 140); }}>
    <button type="button" ref={trigger} className="help-tip-trigger" aria-label={`${label ?? content.label} 도움말`} aria-expanded={state.open} aria-describedby={state.open ? id : undefined} aria-controls={state.open ? id : undefined} aria-keyshortcuts={state.open ? 'ArrowUp ArrowDown PageUp PageDown Home End' : undefined} onKeyDown={event => {
      if (!state.open || !popover.current || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = helpTipScrollTarget(event.key, popover.current);
      if (target === null) return;
      event.preventDefault(); event.stopPropagation(); popover.current.scrollTop = target;
    }} onFocus={() => dispatch('focus')} onBlur={() => dispatch('blur')} onClick={event => { event.preventDefault(); event.stopPropagation(); dispatch('toggle'); }}><CircleHelp size={15} aria-hidden="true"/></button>
    {state.open && <span id={id} ref={popover} className="help-tip-popover" role="tooltip" data-placement={position?.placement} style={{ position: 'fixed', top: position?.top ?? 0, left: position?.left ?? 0, maxWidth: position?.maxWidth, maxHeight: position?.maxHeight, visibility: position ? 'visible' : 'hidden' }} onPointerEnter={clearLeaveTimer}>
      <strong className="help-tip-title">{content.title}</strong><span className="help-tip-body">{content.body}</span>
    </span>}
  </span>;
}

export default HelpTip;
