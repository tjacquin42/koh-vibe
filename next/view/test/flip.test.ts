import { describe, expect, it } from 'vitest';
import { foldChanges, leaveFrames } from '../src/hooks/useFlip';

describe('the sections that just folded or opened (19/11)', () => {
  const at = (folded: boolean) => ({ folded });
  it('are those whose heading was there before and changed state — the others move with them', () => {
    const before = new Map([['f1', at(false)], ['f2', at(true)], ['f3', at(false)]]);
    const now = new Map([['f1', at(true)], ['f2', at(false)], ['f3', at(false)], ['new', at(false)]]);
    expect(foldChanges(before, now)).toEqual(['f1', 'f2']);
    expect(foldChanges(now, now)).toEqual([]);
    // A heading that just appeared, or left, folded nothing.
    expect(foldChanges(new Map(), now)).toEqual([]);
  });
});

describe('leaveFrames: how a vanishing row leaves (21/11)', () => {
  it('goes into its own heading quickly, or folds where it stands', () => {
    const [frames, opts] = leaveFrames(-40, false);
    expect(frames.at(-1)).toEqual({ opacity: 0, transform: 'translateY(-40px) scaleY(0.6)' });
    expect(opts.duration).toBe(240);
    expect(leaveFrames(undefined, false)[0].at(-1)).toEqual({ opacity: 0, transform: 'scaleY(0.2)' });
  });

  it('travels to the Archives — down from a folder, up from « no folder » — seen most of the way', () => {
    const [down, slow] = leaveFrames(600, true);
    expect(down[1]).toMatchObject({ opacity: 0.9, offset: 0.7, transform: 'translateY(420px) scaleY(0.9)' });
    expect(down.at(-1)).toEqual({ opacity: 0, transform: 'translateY(600px) scaleY(0.5)' });
    expect(slow.duration).toBe(470);
    expect(leaveFrames(-120, true)[0].at(-1)).toEqual({ opacity: 0, transform: 'translateY(-120px) scaleY(0.5)' });
    // Near, never quicker than a slide; far, never past its bound.
    expect(leaveFrames(10, true)[1].duration).toBe(323);
    expect(leaveFrames(5000, true)[1].duration).toBe(560);
  });
});
