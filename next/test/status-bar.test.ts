import { describe, expect, it } from 'vitest';
import { statusText } from '../src/host/status-bar';
import { sampleSnapshot } from '../view/src/fixture';

describe('statusText', () => {
  it('counts waiting, working and finished, ended ones aside', () => {
    expect(statusText(sampleSnapshot(0))).toEqual({ text: '$(question) 1 · $(circle-filled) 1 · $(check) 1', waiting: 1, total: 4 });
  });

  it('shows a plain total when nothing waits, works or finished', () => {
    const snap = sampleSnapshot(0);
    snap.sessions = snap.sessions.map((s) => ({ ...s, status: 'idle' }));
    expect(statusText(snap)?.text).toBe('$(circle-outline) 4');
  });

  it('hides with no open conversation', () => {
    const snap = sampleSnapshot(0);
    snap.sessions = snap.sessions.filter((s) => s.endedAt !== undefined);
    expect(statusText(snap)).toBeUndefined();
  });
});
