import { describe, expect, it } from 'vitest';
import { VanishWatch, vanishedIds } from '../src/store/vanish';

/** A schedule that fires only when the test says so, and counts the asks. */
function scheduler() {
  const pending: Array<() => void> = [];
  let cancelled = 0;
  return {
    pending,
    cancelled: () => cancelled,
    schedule: (fire: () => void): (() => void) => {
      pending.push(fire);
      return () => {
        cancelled += 1;
      };
    },
    fireAll: (): void => {
      for (const f of pending.splice(0)) f();
    },
  };
}

describe('vanishedIds', () => {
  it('names what was there and is not any more', () => {
    expect(vanishedIds(new Set(['a', 'b', 'c']), ['a', 'c'])).toEqual(['b']);
    expect(vanishedIds(new Set(['a']), ['a', 'z'])).toEqual([]);
  });
});

describe('VanishWatch', () => {
  it('never reacts to the first observation: there is nothing to compare against', () => {
    const s = scheduler();
    let fired = 0;
    const w = new VanishWatch(() => void fired++, s.schedule);
    w.observe(['a', 'b']);
    expect(s.pending).toHaveLength(0);
  });

  it('schedules one reaction when a session disappears, and fires it', () => {
    const s = scheduler();
    let fired = 0;
    const w = new VanishWatch(() => void fired++, s.schedule);
    w.observe(['a', 'b']);
    w.observe(['a']);
    expect(s.pending).toHaveLength(1);
    s.fireAll();
    expect(fired).toBe(1);
  });

  it('coalesces disappearances that happen while a reaction is pending', () => {
    const s = scheduler();
    const w = new VanishWatch(() => undefined, s.schedule);
    w.observe(['a', 'b', 'c']);
    w.observe(['a', 'b']);
    w.observe(['a']);
    w.observe([]);
    expect(s.pending).toHaveLength(1);
  });

  it('reacts again to a disappearance after the pending one has fired', () => {
    const s = scheduler();
    let fired = 0;
    const w = new VanishWatch(() => void fired++, s.schedule);
    w.observe(['a', 'b']);
    w.observe(['a']);
    s.fireAll();
    w.observe([]);
    s.fireAll();
    expect(fired).toBe(2);
  });

  it('ignores appearances', () => {
    const s = scheduler();
    const w = new VanishWatch(() => undefined, s.schedule);
    w.observe(['a']);
    w.observe(['a', 'b', 'c']);
    expect(s.pending).toHaveLength(0);
  });

  it('cancels a pending reaction on dispose', () => {
    const s = scheduler();
    const w = new VanishWatch(() => undefined, s.schedule);
    w.observe(['a']);
    w.observe([]);
    w.dispose();
    expect(s.cancelled()).toBe(1);
  });
});
