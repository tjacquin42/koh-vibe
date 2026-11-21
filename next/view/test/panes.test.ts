import { describe, expect, it } from 'vitest';
import { PANE_GAP, pullOffset, pushFrames, rideFrames } from '../src/hooks/usePanes';

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

  it('starts from where a section caught in the last push got to, the next one beside it', () => {
    // Coming in from the right, 120 px from its place: it turns around and leaves from there.
    expect(pushFrames(1, -120).leaving[0]).toBe('translateX(120px)');
    expect(pushFrames(1, -120).entering[0]).toBe(`translateX(calc(100% + ${PANE_GAP + 120}px))`);
  });

  it('sends the one before out along with the one leaving, the same distance apart', () => {
    expect(rideFrames(1, -200, -320)).toEqual(['translateX(-200px)', `translateX(calc(-100% - ${PANE_GAP}px + -320px))`]);
    expect(rideFrames(-1, 200, 320)[1]).toBe(`translateX(calc(100% + ${PANE_GAP}px + 320px))`);
  });

  it('follows the fingers, but not at all toward an end — before the first section or after the last', () => {
    expect(pullOffset(40, false)).toBe(40);
    expect(pullOffset(-40, false)).toBe(-40);
    expect(pullOffset(40, true)).toBe(0);
    expect(pullOffset(-40, true)).toBe(0);
  });
});
