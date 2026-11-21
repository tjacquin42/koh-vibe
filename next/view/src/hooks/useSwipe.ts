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
  /** What the gesture under way is: undecided yet, a scroll left to the page, or a swipe. */
  mode: 'idle' | 'scroll' | 'swipe' | 'done';
  dx: number;
  last: number;
}

export const SWIPE_START: SwipeState = { mode: 'idle', dx: 0, last: Number.NEGATIVE_INFINITY };

/**
 * One wheel event of a gesture: the next state, whether the event is the
 * gesture's (and must not scroll anything), and the step to take, if this
 * event is the one that crossed the distance — +1 for the fingers moving
 * left (the next section), -1 right.
 */
export function swipeStep(
  st: SwipeState,
  e: { dx: number; dy: number; at: number; scrollable: boolean },
): { state: SwipeState; claim: boolean; step?: 1 | -1 } {
  const fresh = e.at - st.last > GESTURE_GAP_MS;
  const base: SwipeState = fresh ? { mode: 'idle', dx: 0, last: e.at } : { ...st, last: e.at };
  if (base.mode === 'scroll') return { state: base, claim: false };
  if (base.mode === 'done') return { state: base, claim: true };
  if (Math.abs(e.dx) <= Math.abs(e.dy)) return { state: base, claim: false };
  if (base.mode === 'idle' && e.scrollable) return { state: { ...base, mode: 'scroll' }, claim: false };
  const dx = base.dx + e.dx;
  if (Math.abs(dx) < SWIPE_DISTANCE) return { state: { ...base, mode: 'swipe', dx }, claim: true };
  return { state: { ...base, mode: 'done', dx: 0 }, claim: true, step: dx > 0 ? 1 : -1 };
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

/** Listens for the gesture over `root`; `onStep` changes the section. */
export function useSwipe(root: RefObject<HTMLElement | null>, enabled: boolean, onStep: (step: 1 | -1) => void): void {
  const step = useRef(onStep);
  step.current = onStep;
  useEffect(() => {
    const el = root.current;
    if (!enabled || el === null) return;
    let st = SWIPE_START;
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) return; // a pinch
      const target = e.target instanceof Element ? e.target : null;
      const r = swipeStep(st, { dx: e.deltaX, dy: e.deltaY, at: e.timeStamp, scrollable: scrollsSideways(target, el, e.deltaX) });
      st = r.state;
      if (r.claim) e.preventDefault();
      if (r.step !== undefined) step.current(r.step);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [root, enabled]);
}

/**
 * Which way the new section slides in, from where the last one stood in
 * `order`: from the right for one further on, from the left for one before.
 * Undefined until the section changes — nothing slides when a view opens.
 */
export function useSlide<T>(order: readonly T[], selected: T, animate: boolean): 'slide-next' | 'slide-prev' | undefined {
  const prev = useRef(selected);
  const dir = useRef<'slide-next' | 'slide-prev' | undefined>(undefined);
  if (prev.current !== selected) {
    dir.current = order.indexOf(selected) >= order.indexOf(prev.current) ? 'slide-next' : 'slide-prev';
    prev.current = selected;
  }
  return animate ? dir.current : undefined;
}
