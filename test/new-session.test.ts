import { describe, expect, it } from 'vitest';
import { newSessionAmong } from '../src/store/new-session';
import type { Session } from '../src/events/types';

const s = (id: string, over: Partial<Session> = {}): Session => ({
  id, cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode', status: 'idle', toolCount: 0, lastEventAt: 100, ...over,
});
const map = (...rows: Session[]): Map<string, Session> => new Map(rows.map((r) => [r.id, r]));

describe('newSessionAmong — the conversation a click just opened', () => {
  it('is the one id that was not there before', () => {
    expect(newSessionAmong(new Set(['old']), map(s('old'), s('fresh')), () => true)).toBe('fresh');
  });

  it('is nothing while nothing new has shown up, or while the new one is not this window\'s', () => {
    expect(newSessionAmong(new Set(['old']), map(s('old')), () => true)).toBeUndefined();
    expect(newSessionAmong(new Set(), map(s('elsewhere', { cwd: '/other' })), (x) => x.cwd === '/Users/dev/projet')).toBeUndefined();
  });

  it('takes the earliest of several newcomers: the tab this window opened started first', () => {
    const rows = map(s('later', { startedAt: 300 }), s('first', { startedAt: 200 }), s('undated', { lastEventAt: 250 }));
    expect(newSessionAmong(new Set(), rows, () => true)).toBe('first');
  });
});
