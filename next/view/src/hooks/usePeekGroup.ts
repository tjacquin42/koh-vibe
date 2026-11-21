import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PeekTone } from '../sections';

/**
 * The sidebar's three counts share one bubble (21/11): never two shown at
 * once. Hovering a count opens its bubble after a short pause — the pointer
 * crossing it by chance opens nothing — but with a bubble already open, or
 * still fading, the next one opens at once and the last one is gone at once:
 * one goes from count to count freely. Leaving them all, the bubble fades out.
 */
export const SHOW_DELAY_MS = 350;
/** Time to cross the gap between a count and its bubble, or to the next count. */
export const HIDE_MS = 220;
/** How long a bubble takes to fade out (app.css .popover.leaving). */
export const FADE_MS = 160;

export interface PeekState {
  open?: PeekTone;
  /** The bubble fading out, still drawn. */
  leaving?: PeekTone;
}

/** What the pointer reaching a count does: open now, open after the pause, or nothing. */
export function onEnter(state: PeekState, any: boolean): 'now' | 'later' | 'none' {
  if (!any) return 'none';
  return state.open !== undefined || state.leaving !== undefined ? 'now' : 'later';
}

export interface PeekGroup {
  state: PeekState;
  enter(tone: PeekTone, any: boolean): void;
  leave(): void;
  /** A press on a count: its bubble at once, or closed if it is the one shown. */
  toggle(tone: PeekTone): void;
  /** Clicked elsewhere, Escape, a card chosen: the bubble fades out. */
  close(): void;
}

export function usePeekGroup(): PeekGroup {
  const [state, setState] = useState<PeekState>({});
  const cur = useRef(state);
  cur.current = state;
  const timers = useRef<{ show?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout>; fade?: ReturnType<typeof setTimeout> }>({});
  const stop = (k: 'show' | 'hide' | 'fade'): void => {
    clearTimeout(timers.current[k]);
    timers.current[k] = undefined;
  };
  useEffect(
    () => () => {
      stop('show');
      stop('hide');
      stop('fade');
    },
    [],
  );
  const show = useCallback((tone: PeekTone) => {
    stop('show');
    stop('hide');
    stop('fade');
    // The one shown before goes at once: no fade when going from one to the next.
    setState({ open: tone });
  }, []);
  const close = useCallback(() => {
    stop('show');
    stop('hide');
    const open = cur.current.open;
    if (open === undefined) return;
    setState({ leaving: open });
    stop('fade');
    timers.current.fade = setTimeout(() => setState((s) => (s.open === undefined ? {} : { open: s.open })), FADE_MS);
  }, []);
  const enter = useCallback(
    (tone: PeekTone, any: boolean) => {
      const what = onEnter(cur.current, any);
      if (what === 'none') return;
      stop('hide');
      if (what === 'now') show(tone);
      else {
        stop('show');
        timers.current.show = setTimeout(() => show(tone), SHOW_DELAY_MS);
      }
    },
    [show],
  );
  const leave = useCallback(() => {
    stop('show');
    stop('hide');
    timers.current.hide = setTimeout(close, HIDE_MS);
  }, [close]);
  const toggle = useCallback(
    (tone: PeekTone) => {
      if (cur.current.open === tone) close();
      else show(tone);
    },
    [show, close],
  );
  return useMemo(() => ({ state, enter, leave, toggle, close }), [state, enter, leave, toggle, close]);
}
