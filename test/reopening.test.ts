import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REOPEN_WAIT_MS, Reopening } from '../src/ui/reopening';

describe('the conversations being brought back', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists a conversation from the click on, and tells the trees', () => {
    const changes: string[][] = [];
    const reopening = new Reopening((ids) => changes.push([...ids].sort()));
    reopening.start('a');
    expect(reopening.has('a')).toBe(true);
    expect(changes).toEqual([['a']]);
  });

  it('settles a conversation the moment it is open again, and says nothing when nothing was waiting', () => {
    const changes: string[][] = [];
    const reopening = new Reopening((ids) => changes.push([...ids].sort()));
    reopening.start('a');
    reopening.start('b');
    // A render pass with other conversations open: nothing to announce.
    reopening.settle(['x', 'y']);
    expect(changes).toHaveLength(2);
    reopening.settle(['a', 'x']);
    expect(reopening.has('a')).toBe(false);
    expect(reopening.has('b')).toBe(true);
    expect(changes.at(-1)).toEqual(['b']);
  });

  it('stops a wait the caller gives up on, and ignores one it never had', () => {
    const changes: string[][] = [];
    const reopening = new Reopening((ids) => changes.push([...ids]));
    reopening.stop('nobody');
    expect(changes).toEqual([]);
    reopening.start('a');
    reopening.stop('a');
    expect(reopening.has('a')).toBe(false);
    expect(changes).toEqual([['a'], []]);
  });

  it('gives up on its own after the wait, so a resume that never shows up leaves no spinner behind', () => {
    const changes: string[][] = [];
    const reopening = new Reopening((ids) => changes.push([...ids]));
    reopening.start('a');
    vi.advanceTimersByTime(REOPEN_WAIT_MS - 1);
    expect(reopening.has('a')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(reopening.has('a')).toBe(false);
    expect(changes.at(-1)).toEqual([]);
  });

  it('restarts the clock when the same conversation is asked for again', () => {
    const reopening = new Reopening(() => undefined, 1_000);
    reopening.start('a');
    vi.advanceTimersByTime(800);
    reopening.start('a');
    vi.advanceTimersByTime(800);
    expect(reopening.has('a')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(reopening.has('a')).toBe(false);
  });

  it('drops every wait on dispose, without a redraw the window will never paint', () => {
    const changes: string[][] = [];
    const reopening = new Reopening((ids) => changes.push([...ids]));
    reopening.start('a');
    reopening.dispose();
    expect(reopening.has('a')).toBe(false);
    expect(changes).toEqual([['a']]);
    vi.runAllTimers();
    expect(changes).toEqual([['a']]);
  });
});
