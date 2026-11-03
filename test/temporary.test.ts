import { describe, expect, it } from 'vitest';
import { TEMPORARY_TTL_MS, temporaryToExpire } from '../src/store/temporary';
import type { Session } from '../src/events/types';

const NOW = 10 * TEMPORARY_TTL_MS;
const s = (id: string, over: Partial<Session> = {}): Session => ({
  id, cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode', status: 'idle', toolCount: 0, lastEventAt: NOW - 2 * TEMPORARY_TTL_MS, ...over,
});
const ids = (rows: Session[]): string[] => rows.map((r) => r.id);
const nowhere = (): boolean => false;
const everywhere = (): boolean => true;

describe('temporaryToExpire — a conversation filed nowhere, quiet for a day', () => {
  it('removes an ended one: nothing runs behind it, no tab to close', () => {
    const plan = temporaryToExpire([s('old-ended', { endedAt: NOW - 2 * TEMPORARY_TTL_MS })], nowhere, nowhere, NOW);
    expect(ids(plan.remove)).toEqual(['old-ended']);
    expect(plan.close).toEqual([]);
  });

  it('closes an open one whose tab this window can tell apart', () => {
    const plan = temporaryToExpire([s('old-open')], nowhere, (id) => id === 'old-open', NOW);
    expect(ids(plan.close)).toEqual(['old-open']);
    expect(plan.remove).toEqual([]);
  });

  it('leaves an open one in the list when its tab cannot be found: never a tab without its row', () => {
    // Hiding it is what used to happen, and its tab stayed on screen with no
    // row left to reach or close it from.
    expect(temporaryToExpire([s('old-open')], nowhere, nowhere, NOW)).toEqual({ remove: [], close: [] });
  });

  it('closes the tab of a row hidden earlier — the orphans the old rule left behind', () => {
    const plan = temporaryToExpire([s('orphan', { hidden: true })], nowhere, everywhere, NOW);
    expect(ids(plan.close)).toEqual(['orphan']);
  });

  it('leaves a hidden row alone when there is no tab to close, or nothing runs behind it', () => {
    const rows = [s('hidden-open', { hidden: true }), s('hidden-ended', { hidden: true, endedAt: 0 })];
    expect(temporaryToExpire(rows, nowhere, nowhere, NOW)).toEqual({ remove: [], close: [] });
    expect(temporaryToExpire([rows[1]!], nowhere, everywhere, NOW)).toEqual({ remove: [], close: [] });
  });

  it('keeps a filed one whatever its age: the user sorted it', () => {
    const rows = [s('filed'), s('filed-ended', { endedAt: 0 })];
    expect(temporaryToExpire(rows, everywhere, everywhere, NOW)).toEqual({ remove: [], close: [] });
  });

  it('skips a dormant tab — no age to count', () => {
    expect(temporaryToExpire([s('dormant', { dormant: true, lastEventAt: 0 })], nowhere, everywhere, NOW)).toEqual({
      remove: [],
      close: [],
    });
  });

  it('is exactly the ttl: a day less a millisecond stays, a day and a millisecond goes', () => {
    const edge = (lastEventAt: number): Session[] =>
      temporaryToExpire([s('edge', { lastEventAt })], nowhere, everywhere, NOW).close;
    expect(ids(edge(NOW - TEMPORARY_TTL_MS))).toEqual([]);
    expect(ids(edge(NOW - TEMPORARY_TTL_MS - 1))).toEqual(['edge']);
  });

  it('takes another ttl when asked', () => {
    expect(ids(temporaryToExpire([s('x', { lastEventAt: NOW - 5000 })], nowhere, everywhere, NOW, 1000).close)).toEqual(['x']);
  });
});
