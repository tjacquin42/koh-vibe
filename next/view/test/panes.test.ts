import { describe, expect, it } from 'vitest';
import { PANE_GAP, pullOffset, pushFrames } from '../src/hooks/usePanes';

describe('the push between two sections (21/11)', () => {
  it('sends the one left out the way the fingers went, and brings the next from the other side, a gap between', () => {
    expect(pushFrames(1, 0)).toEqual({
      leaving: ['translateX(0px)', `translateX(calc(-100% - ${PANE_GAP}px))`],
      entering: [`translateX(calc(100% + ${PANE_GAP}px))`, 'translateX(0px)'],
    });
    expect(pushFrames(-1, 0).leaving[1]).toBe(`translateX(calc(100% + ${PANE_GAP}px))`);
    expect(pushFrames(-1, 0).entering[0]).toBe(`translateX(calc(-100% - ${PANE_GAP}px))`);
  });

  it('starts from where the fingers left the section', () => {
    expect(pushFrames(1, 40).leaving[0]).toBe('translateX(-40px)');
    expect(pushFrames(1, 40).entering[0]).toBe(`translateX(calc(100% + ${PANE_GAP - 40}px))`);
    expect(pushFrames(-1, -40).entering[0]).toBe(`translateX(calc(-100% - ${PANE_GAP - 40}px))`);
  });

  it('follows the fingers, but not at all toward an end — before the first section or after the last', () => {
    expect(pullOffset(40, false)).toBe(40);
    expect(pullOffset(-40, false)).toBe(-40);
    expect(pullOffset(40, true)).toBe(0);
    expect(pullOffset(-40, true)).toBe(0);
  });
});
