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

describe('a new gesture during the momentum of the last one (21/11)', () => {
  // Fingers speeding up, then the momentum slowing down for most of a second — a trackpad's swipe.
  const tail = Array.from({ length: 30 }, (_, i) => (i < 10 ? 2 : 1));
  const swipe = (sign: number) => [4, 8, 12, 16, 20, 22, 20, 16, 12, 9, 7, 5, 4, 3, 2, ...tail].map((d) => ({ dx: sign * d }));

  it('moves again, without waiting for the trackpad to go still', () => {
    expect(run([...swipe(1), ...swipe(1)]).steps).toEqual([1, 1]);
    expect(run([...swipe(1), ...swipe(-1)]).steps).toEqual([1, -1]);
  });

  it('never moves twice for fingers that keep speeding up after the change', () => {
    expect(run([4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44].map((dx) => ({ dx }))).steps).toEqual([1]);
  });

  it('changes one section only, however the momentum of one gesture wavers', () => {
    // Bumps in the momentum, before and after the push is over: never new fingers.
    const wavering = [4, 8, 12, 16, 20, 24, 18, 14, 15, 16, 17, 12, 10, 8, 9, 10, 7, 5, ...tail, 2, 3, 2, 1, 1].map((dx) => ({ dx }));
    expect(run(wavering).steps).toEqual([1]);
    // A swipe made slowly, its fingers speeding up and slowing down twice.
    expect(run([3, 6, 9, 12, 15, 18, 14, 10, 12, 14, 16, 12, 8, 5, 3, 2, 1].map((dx) => ({ dx }))).steps).toEqual([1]);
  });

  it('never takes the momentum alone for new fingers, nor a single bump in it', () => {
    expect(run([...swipe(1), { dx: 3 }, { dx: 2 }, { dx: 1 }]).steps).toEqual([1]);
    expect(run([...swipe(1).slice(0, 9), { dx: 10 }, { dx: 6 }, { dx: 4 }]).steps).toEqual([1]);
  });

  it('keeps pulling at an end: no step, and nothing moves (hooks/usePanes.ts)', () => {
    let st = SWIPE_START;
    const steps: number[] = [];
    [4, 8, 12, 16, 20, 22].forEach((dx, i) => {
      const r = swipeStep(st, { dx, dy: 0, at: 1_000 + i * 16, scrollable: false, can: () => false });
      st = r.state;
      if (r.step !== undefined) steps.push(r.step);
    });
    expect(steps).toEqual([]);
    expect(st).toMatchObject({ mode: 'swipe', dx: 82 });
  });
});
