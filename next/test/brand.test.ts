import { describe, expect, it } from 'vitest';
import { bandNodes, brandParts, sunTone } from '../view/src/ui/brand';

describe('the sidebar name (C2)', () => {
  it('is Koh, a bar, Vibe — the hyphen no character', () => {
    expect(brandParts('Koh-Vibe')).toEqual([{ kind: 'text', text: 'Koh' }, { kind: 'dash' }, { kind: 'text', text: 'Vibe' }]);
    // A name with no hyphen, or one at an edge, stays one piece of text.
    expect(brandParts('Cockpit')).toEqual([{ kind: 'text', text: 'Cockpit' }]);
    expect(brandParts('-Koh')).toEqual([{ kind: 'text', text: '-Koh' }]);
    expect(brandParts('Koh-')).toEqual([{ kind: 'text', text: 'Koh-' }]);
  });

  it('gives the rainbow a layer of the same structure: the text, and an empty box where the bar is', () => {
    expect(bandNodes(brandParts('Koh-Vibe'))).toEqual([{ text: 'Koh' }, { className: 'brand-dash brand-dash-ghost' }, { text: 'Vibe' }]);
    expect(bandNodes(brandParts('Cockpit'))).toEqual([{ text: 'Cockpit' }]);
  });
});

describe('the sun of the logo alone', () => {
  it('is coral when a conversation waits, else lagoon when one works, else sea green', () => {
    expect(sunTone({ waiting: 1, running: 3, done: 2 })).toBe('wait');
    expect(sunTone({ waiting: 0, running: 1, done: 2 })).toBe('run');
    expect(sunTone({ waiting: 0, running: 0, done: 2 })).toBe('done');
    // No conversation at all: sea green too.
    expect(sunTone({ waiting: 0, running: 0, done: 0 })).toBe('done');
  });
});
