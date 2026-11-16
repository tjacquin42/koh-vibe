import { describe, expect, it } from 'vitest';
import { brandName } from '../view/src/lib/brand';

describe('the sidebar name (C2)', () => {
  it('is K, o, h, a bar, V, ib — and the final e apart', () => {
    expect(brandName('Koh-Vibe')).toEqual({
      body: [
        { kind: 'letter', text: 'K', fix: 'k' },
        { kind: 'text', text: 'o' },
        { kind: 'letter', text: 'h', fix: 'h' },
        { kind: 'dash' },
        { kind: 'letter', text: 'V', fix: 'v' },
        { kind: 'text', text: 'ib' },
      ],
      tail: 'e',
    });
  });

  it('keeps a name with no hyphen, or one at an edge, as one piece of text with no tail', () => {
    expect(brandName('Cockpit')).toEqual({ body: [{ kind: 'text', text: 'Cockpit' }], tail: null });
    expect(brandName('-Koh')).toEqual({ body: [{ kind: 'text', text: '-Koh' }], tail: null });
    expect(brandName('Koh-')).toEqual({ body: [{ kind: 'text', text: 'Koh-' }], tail: null });
  });

  it('fixes each letter once, and gives no tail to a name that does not end with an e', () => {
    expect(brandName('Kah-Vah')).toEqual({
      body: [
        { kind: 'letter', text: 'K', fix: 'k' },
        { kind: 'text', text: 'a' },
        { kind: 'letter', text: 'h', fix: 'h' },
        { kind: 'dash' },
        { kind: 'letter', text: 'V', fix: 'v' },
        { kind: 'text', text: 'ah' },
      ],
      tail: null,
    });
  });
});
