import { describe, expect, it } from 'vitest';
import { mementoTtl } from '../src/host/active-tab';

describe('how often the editor’s memento is read (16/11)', () => {
  it('every two seconds while the tabs are moving — the editor writes it a little after a tab opens', () => {
    expect(mementoTtl(0)).toBe(2_000);
    expect(mementoTtl(20_000)).toBe(2_000);
  });

  it('once a minute when they are still: a build every few seconds must not start a sqlite3 each time', () => {
    expect(mementoTtl(20_001)).toBe(60_000);
    expect(mementoTtl(3_600_000)).toBe(60_000);
  });
});
