import { useEffect, useRef, type RefObject } from 'react';

/**
 * Two fingers swept left or right on a trackpad go to the next or the previous
 * section (21/11) — the sidebar's tabs, the cockpit's views. The trackpad
 * sends them as horizontal wheel events, a burst per gesture and its momentum
 * after: one gesture moves one section, however long it runs.
 *
 * A gesture that begins over something that scrolls sideways (a folder bar,
 * the board's columns) scrolls it and never changes section, even when it
 * reaches the end: a section change should not surprise a scroll.
 */

/** How far the fingers travel, in pixels of wheel, before the section changes. */
export const SWIPE_DISTANCE = 60;
/** A pause longer than this between two wheel events starts a new gesture. */
export const GESTURE_GAP_MS = 220;

export interface SwipeState {
  /** What the gesture under way is: undecided yet, a scroll left to the page, a swipe, or one already used. */
  mode: 'idle' | 'scroll' | 'swipe' | 'done';
  dx: number;
  last: number;
  /** Once used: the last step's size, and the run of growing ones since — new fingers, not momentum. */
  prev?: number;
  /** The used gesture has slowed down once: growing steps after that are new fingers, not the same ones. */
  armed?: boolean;
  rise?: number;
  rises?: number;
}

export const SWIPE_START: SwipeState = { mode: 'idle', dx: 0, last: Number.NEGATIVE_INFINITY };

/** Growing steps in a row that tell new fingers from the momentum of the gesture just used. */
const RISES = 2;

/**
 * One wheel event of a gesture: the next state, whether the event is the
 * gesture's (and must not scroll anything), and the step to take, if this
 * event is the one that crossed the distance — +1 for the fingers moving
 * left (the next section), -1 right.
 */
export function swipeStep(
  st: SwipeState,
  e: { dx: number; dy: number; at: number; scrollable: boolean; can?: (step: 1 | -1) => boolean },
): { state: SwipeState; claim: boolean; step?: 1 | -1 } {
  const fresh = e.at - st.last > GESTURE_GAP_MS;
  const base: SwipeState = fresh ? { mode: 'idle', dx: 0, last: e.at } : { ...st, last: e.at };
  if (base.mode === 'scroll') return { state: base, claim: false };
  if (base.mode === 'done') {
    // The momentum of a used gesture only slows down; fingers laid again speed up. A new
    // gesture begun before the momentum ran out was swallowed whole: the next swipe did
    // nothing until the trackpad went still (21/11).
    const size = Math.abs(e.dx);
    const prev = base.prev ?? Number.POSITIVE_INFINITY;
    const armed = base.armed === true || size < prev;
    const growing = base.armed === true && size > prev && size >= 3;
    const rise = growing ? (base.rise ?? 0) + e.dx : 0;
    const rises = growing ? (base.rises ?? 0) + 1 : 0;
    if (rises < RISES) return { state: { ...base, prev: size, armed, rise, rises }, claim: true };
    return swipeStep({ mode: 'idle', dx: rise - e.dx, last: e.at }, e);
  }
  if (Math.abs(e.dx) <= Math.abs(e.dy)) return { state: base, claim: false };
  if (base.mode === 'idle' && e.scrollable) return { state: { ...base, mode: 'scroll' }, claim: false };
  const dx = base.dx + e.dx;
  const step: 1 | -1 = dx > 0 ? 1 : -1;
  // Nothing that way: no change, and the section does not follow (hooks/usePanes.ts).
  if (Math.abs(dx) < SWIPE_DISTANCE || !(e.can?.(step) ?? true)) return { state: { ...base, mode: 'swipe', dx }, claim: true };
  return { state: { mode: 'done', dx: 0, last: e.at, prev: Math.abs(e.dx), rise: 0, rises: 0 }, claim: true, step };
}

/** Whether something between `target` and `root` can scroll sideways the way `dx` goes. */
export function scrollsSideways(target: Element | null, root: Element, dx: number): boolean {
  for (let el = target; el !== null && el !== root.parentElement; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const x = getComputedStyle(el).overflowX;
    if (x !== 'auto' && x !== 'scroll') continue;
    if (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0) return true;
  }
  return false;
}

/** The next or previous of `order` from `selected`, none past either end. */
export function stepIn<T>(order: readonly T[], selected: T, step: 1 | -1): T | undefined {
  const i = order.indexOf(selected);
  return i < 0 ? undefined : order[i + step];
}

export interface SwipeHandlers {
  /** Whether there is a section that way. */
  can(step: 1 | -1): boolean;
  /** The fingers' offset so far, before a change. */
  drag(dx: number, ends: boolean): void;
  /** The gesture ended without a change. */
  release(): void;
  /** The change: +1 the next section, -1 the previous one. */
  step(step: 1 | -1): void;
}

/** Listens for the gesture over `root`. */
export function useSwipe(root: RefObject<HTMLElement | null>, enabled: boolean, handlers: SwipeHandlers): void {
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    const el = root.current;
    if (!enabled || el === null) return;
    let st = SWIPE_START;
    let end: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) return; // a pinch
      const target = e.target instanceof Element ? e.target : null;
      const r = swipeStep(st, { dx: e.deltaX, dy: e.deltaY, at: e.timeStamp, scrollable: scrollsSideways(target, el, e.deltaX), can: (s) => h.current.can(s) });
      st = r.state;
      if (r.claim) e.preventDefault();
      clearTimeout(end);
      if (r.step !== undefined) {
        h.current.step(r.step);
        return;
      }
      if (st.mode !== 'swipe') return;
      h.current.drag(st.dx, !h.current.can(st.dx > 0 ? 1 : -1));
      end = setTimeout(() => h.current.release(), GESTURE_GAP_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      clearTimeout(end);
      el.removeEventListener('wheel', onWheel);
    };
  }, [root, enabled]);
}
