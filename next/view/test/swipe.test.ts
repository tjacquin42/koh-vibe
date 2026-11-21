import { afterEach, describe, expect, it, vi } from 'vitest';
import { GESTURE_GAP_MS, scrollsSideways, stepIn, SWIPE_DISTANCE, SWIPE_START, swipeStep, type SwipeState } from '../src/hooks/useSwipe';

/** Feeds a gesture's events one after the other, 16 ms apart; returns the steps taken and the last state. */
function run(events: { dx: number; dy?: number; scrollable?: boolean }[], from: SwipeState = SWIPE_START, start = 1_000) {
  let st = from;
  const steps: number[] = [];
  const claims: boolean[] = [];
  events.forEach((e, i) => {
    const r = swipeStep(st, { dx: e.dx, dy: e.dy ?? 0, at: start + i * 16, scrollable: e.scrollable ?? false });
    st = r.state;
    claims.push(r.claim);
    if (r.step !== undefined) steps.push(r.step);
  });
  return { st, steps, claims };
}

const burst = (dx: number, n = 12) => Array.from({ length: n }, () => ({ dx }));

describe('swipeStep (21/11)', () => {
  it('takes one step per gesture, however long its momentum runs', () => {
    const { steps, claims } = run(burst(15, 30));
    expect(steps).toEqual([1]);
    expect(claims.every(Boolean)).toBe(true);
  });

  it('goes back with the fingers moving right', () => {
    expect(run(burst(-15)).steps).toEqual([-1]);
  });

  it('takes nothing short of the distance', () => {
    expect(run(burst(5, Math.floor((SWIPE_DISTANCE - 1) / 5))).steps).toEqual([]);
  });

  it('starts a new gesture after a pause', () => {
    const first = run(burst(15));
    const second = run(burst(15), first.st, 1_000 + 12 * 16 + GESTURE_GAP_MS + 1);
    expect(second.steps).toEqual([1]);
  });

  it('leaves a vertical scroll alone', () => {
    const { steps, claims } = run(Array.from({ length: 12 }, () => ({ dx: 15, dy: 40 })));
    expect(steps).toEqual([]);
    expect(claims.some(Boolean)).toBe(false);
  });

  it('leaves the whole gesture to what scrolls sideways under it, even past its end', () => {
    const { steps, claims } = run([{ dx: 15, scrollable: true }, ...burst(15, 20)]);
    expect(steps).toEqual([]);
    expect(claims.some(Boolean)).toBe(false);
  });
});

describe('stepIn', () => {
  const order = ['a', 'b', 'c'];
  it('moves one along, never past either end', () => {
    expect(stepIn(order, 'a', 1)).toBe('b');
    expect(stepIn(order, 'b', -1)).toBe('a');
    expect(stepIn(order, 'c', 1)).toBeUndefined();
    expect(stepIn(order, 'a', -1)).toBeUndefined();
    expect(stepIn(order, 'z', 1)).toBeUndefined();
  });
});

describe('scrollsSideways', () => {
  afterEach(() => vi.unstubAllGlobals());
  type Box = { scrollWidth: number; clientWidth: number; scrollLeft: number; overflowX: string; parentElement: Box | null };
  const box = (over: Partial<Box>, parentElement: Box | null = null): Box => ({ scrollWidth: 100, clientWidth: 100, scrollLeft: 0, overflowX: 'visible', parentElement, ...over });

  it('sees a bar that can still scroll the way the fingers go, and not one at its end', () => {
    vi.stubGlobal('getComputedStyle', (el: Box) => ({ overflowX: el.overflowX }));
    const root = box({});
    const bar = box({ scrollWidth: 300, clientWidth: 100, scrollLeft: 0, overflowX: 'auto' }, root);
    const chip = box({}, bar);
    const asEl = (b: Box) => b as unknown as Element;
    expect(scrollsSideways(asEl(chip), asEl(root), 10)).toBe(true);
    expect(scrollsSideways(asEl(chip), asEl(root), -10)).toBe(false);
    bar.scrollLeft = 200;
    expect(scrollsSideways(asEl(chip), asEl(root), 10)).toBe(false);
    expect(scrollsSideways(asEl(chip), asEl(root), -10)).toBe(true);
    // Wide but clipped, not scrolling: nothing to scroll.
    bar.overflowX = 'hidden';
    expect(scrollsSideways(asEl(chip), asEl(root), -10)).toBe(false);
    expect(scrollsSideways(null, asEl(root), 10)).toBe(false);
  });
});
