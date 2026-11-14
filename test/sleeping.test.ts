import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markSleeping, takeSleeping } from '../src/store/sleeping';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'koh-sleeping-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('a conversation put to sleep by hand', () => {
  it('is kept once, by the end that follows', async () => {
    await markSleeping(home, 'abc-123', 1_000);
    expect(await takeSleeping(home, 'abc-123', 2_000)).toBe(true);
    expect(await takeSleeping(home, 'abc-123', 3_000)).toBe(false);
  });

  it('is not, when no wish was left, or one too old', async () => {
    expect(await takeSleeping(home, 'never', 1_000)).toBe(false);
    await markSleeping(home, 'old', 0);
    expect(await takeSleeping(home, 'old', 11 * 60 * 1000)).toBe(false);
  });

  it('never writes outside its folder', async () => {
    await markSleeping(home, '../escape', 0);
    expect(await takeSleeping(home, '../escape', 0)).toBe(false);
  });
});
