import { describe, expect, it } from 'vitest';
import { PANE_GAP, pushFrames, resist } from '../src/hooks/usePanes';

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

  it('gives less and less at an end, never past 48 px, either way', () => {
    expect(resist(0)).toBe(0);
    expect(resist(60)).toBeGreaterThan(0);
    expect(resist(60)).toBeLessThan(60);
    expect(resist(10_000)).toBeLessThanOrEqual(48);
    expect(resist(-60)).toBe(-resist(60));
  });
});
