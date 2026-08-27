import { describe, expect, it } from 'vitest';
import { TEMPORARY_TTL_MS, temporaryToForget } from '../src/store/temporary';
import type { Session } from '../src/events/types';

const NOW = 10 * TEMPORARY_TTL_MS;
const s = (id: string, over: Partial<Session> = {}): Session => ({
  id, cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode', status: 'idle', toolCount: 0, lastEventAt: NOW - 2 * TEMPORARY_TTL_MS, ...over,
});
const ids = (rows: Session[]): string[] => rows.map((r) => r.id);

describe('temporaryToForget — a conversation filed nowhere, quiet for a day', () => {
  it('names the unfiled ones older than the ttl, open or ended alike', () => {
    const rows = [s('old-open'), s('old-ended', { endedAt: NOW - 2 * TEMPORARY_TTL_MS }), s('fresh', { lastEventAt: NOW - 1000 })];
    expect(ids(temporaryToForget(rows, () => false, NOW))).toEqual(['old-open', 'old-ended']);
  });

  it('keeps a filed one whatever its age: the user sorted it', () => {
    expect(temporaryToForget([s('filed')], (id) => id === 'filed', NOW)).toEqual([]);
  });

  it('is exactly the ttl: a day less a millisecond stays, a day and a millisecond goes', () => {
    expect(ids(temporaryToForget([s('edge', { lastEventAt: NOW - TEMPORARY_TTL_MS })], () => false, NOW))).toEqual([]);
    expect(ids(temporaryToForget([s('edge', { lastEventAt: NOW - TEMPORARY_TTL_MS - 1 })], () => false, NOW))).toEqual(['edge']);
  });

  it('skips a dormant tab — no age to count — and a row already hidden', () => {
    const rows = [s('dormant', { dormant: true, lastEventAt: 0 }), s('hidden', { hidden: true })];
    expect(temporaryToForget(rows, () => false, NOW)).toEqual([]);
  });

  it('takes another ttl when asked', () => {
    expect(ids(temporaryToForget([s('x', { lastEventAt: NOW - 5000 })], () => false, NOW, 1000))).toEqual(['x']);
  });
});
