import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealRow, revealScroll, scrollerOf, settled } from '../src/lib/reveal';

const view = { top: 100, bottom: 500 };

describe('revealScroll (21/11)', () => {
  it('leaves a row already in sight', () => {
    expect(revealScroll({ top: 120, bottom: 160 }, view, 300)).toBeUndefined();
  });

  it('brings a row half under the top edge down, clear of it', () => {
    expect(revealScroll({ top: 80, bottom: 120 }, view, 300)).toBe(300 - 28);
  });

  it('brings a row past the foot up, clear of it', () => {
    expect(revealScroll({ top: 480, bottom: 520 }, view, 300)).toBe(300 + 28);
  });

  it('shows the top of a row taller than the list, and never scrolls above 0', () => {
    expect(revealScroll({ top: 300, bottom: 1_000 }, view, 50)).toBe(50 + 192);
    expect(revealScroll({ top: 0, bottom: 40 }, view, 20)).toBe(0);
  });
});

type FakeAnimation = Pick<Animation, 'finished'> & { effect: { getComputedTiming(): { endTime: number } } };
const animation = (endTime: number, finished: Promise<unknown>): FakeAnimation => ({
  effect: { getComputedTiming: () => ({ endTime }) },
  finished: finished as Promise<Animation>,
});
const host = (animations: FakeAnimation[]): Element => ({ getAnimations: () => animations }) as unknown as Element;

describe('settled', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves at once with nothing moving, or an element that cannot say', async () => {
    await expect(settled(host([]))).resolves.toBeUndefined();
    await expect(settled({} as Element)).resolves.toBeUndefined();
  });

  it('waits for the animations that end, not for one that never does', async () => {
    let end: (() => void) | undefined;
    const slide = new Promise<void>((resolve) => {
      end = resolve;
    });
    let done = false;
    const wait = settled(host([animation(320, slide), animation(Infinity, new Promise(() => undefined))])).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    end?.();
    await wait;
    expect(done).toBe(true);
  });

  it('gives up after its cap', async () => {
    vi.useFakeTimers();
    const wait = settled(host([animation(320, new Promise(() => undefined))]), 50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(wait).resolves.toBeUndefined();
  });
});

describe('scrollerOf and revealRow', () => {
  afterEach(() => vi.unstubAllGlobals());

  const box = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;

  it('finds the nearest ancestor that scrolls, and scrolls it to show the row', async () => {
    vi.stubGlobal('getComputedStyle', (el: { overflowY: string }) => ({ overflowY: el.overflowY }));
    const scrollTo = vi.fn();
    const body = { overflowY: 'auto', parentElement: null, scrollTop: 300, getBoundingClientRect: () => box(100, 500), scrollTo };
    const list = { overflowY: 'visible', parentElement: body };
    const row = { parentElement: list, isConnected: true, getBoundingClientRect: () => box(80, 120) } as unknown as Element;
    expect(scrollerOf(row)).toBe(body);
    await revealRow(host([]), row, true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 272, behavior: 'smooth' });
    await revealRow(host([]), row, false);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 272, behavior: 'auto' });
  });

  it('does nothing for a row gone meanwhile, or with nothing that scrolls', async () => {
    vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'visible' }));
    const gone = { isConnected: false } as unknown as Element;
    await expect(revealRow(host([]), gone, true)).resolves.toBeUndefined();
    const loose = { parentElement: { parentElement: null }, isConnected: true } as unknown as Element;
    expect(scrollerOf(loose)).toBeUndefined();
    await expect(revealRow(host([]), loose, true)).resolves.toBeUndefined();
  });
});
