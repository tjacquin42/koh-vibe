import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/shared/protocol';
import { sampleSnapshot } from '../view/src/fixture';
import { REOPEN_WAIT_MS, settleReopening, startReopening, type Reopening } from '../view/src/reopen';

const NOW = 1_800_000_000_000;

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { ...sampleSnapshot(NOW), ...over };
}

describe('reopening', () => {
  const closedId = sampleSnapshot(NOW).closed[0]?.sessionId ?? '';

  it('waits for a conversation still listed as closed', () => {
    const r = startReopening(new Map(), closedId, NOW);
    expect([...settleReopening(r, snap(), NOW + 1_000).keys()]).toEqual([closedId]);
  });

  it('stops once it is live again, once V1 took it off the list, or after the wait', () => {
    const r: Reopening = startReopening(new Map(), closedId, NOW);
    const back = snap();
    const live = back.sessions[0];
    if (live === undefined) throw new Error('fixture has no session');
    back.sessions = [{ ...live, id: closedId, endedAt: undefined }];
    expect(settleReopening(r, back, NOW + 1_000).size).toBe(0);
    expect(settleReopening(r, snap({ closed: [] }), NOW + 1_000).size).toBe(0);
    expect(settleReopening(r, snap(), NOW + REOPEN_WAIT_MS + 1).size).toBe(0);
  });

  it('keeps waiting while the conversation is a greyed row, off the closed list but not open yet', () => {
    const base = snap();
    const row = base.sessions[0];
    if (row === undefined) throw new Error('fixture has no session');
    const r = startReopening(new Map(), row.id, NOW);
    const greyed = snap({ closed: [], sessions: [{ ...row, endedAt: NOW - 5_000 }] });
    expect([...settleReopening(r, greyed, NOW + 20_000).keys()]).toEqual([row.id]);
    const open = snap({ closed: [], sessions: [{ ...row, endedAt: undefined }] });
    expect(settleReopening(r, open, NOW + 20_000).size).toBe(0);
  });

  it('waits for the tab in front when asked to, not merely for the conversation to be open', () => {
    const base = snap();
    const row = base.sessions[0];
    if (row === undefined) throw new Error('fixture has no session');
    const open = snap({ sessions: [{ ...row, endedAt: undefined }] });
    const r = startReopening(new Map(), row.id, NOW, 'front');
    expect([...settleReopening(r, open, NOW + 1_000, 'someone-else').keys()]).toEqual([row.id]);
    expect([...settleReopening(r, open, NOW + 1_000, undefined).keys()]).toEqual([row.id]);
    expect(settleReopening(r, open, NOW + 1_000, row.id).size).toBe(0);
    // In front but still greyed: not there yet.
    const greyed = snap({ sessions: [{ ...row, endedAt: NOW - 1 }] });
    expect(settleReopening(r, greyed, NOW + 1_000, row.id).size).toBe(1);
    expect(settleReopening(r, open, NOW + REOPEN_WAIT_MS + 1, 'someone-else').size).toBe(0);
  });

  it('ends a wait for the front when another window takes the focus — the conversation lives there', () => {
    const base = snap();
    const row = base.sessions[0];
    if (row === undefined) throw new Error('fixture has no session');
    const r = startReopening(new Map(), row.id, NOW, 'front');
    const elsewhere = snap({ sessions: [{ ...row, endedAt: undefined }], focused: false });
    expect(settleReopening(r, elsewhere, NOW + 1_000, undefined).size).toBe(0);
  });

  it('keeps the same map when nothing settled, so React does not re-render for nothing', () => {
    const r = startReopening(new Map(), closedId, NOW);
    expect(settleReopening(r, snap(), NOW + 1_000)).toBe(r);
  });
});
