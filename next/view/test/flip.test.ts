import { describe, expect, it } from 'vitest';
import { foldChanges } from '../src/hooks/useFlip';

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
