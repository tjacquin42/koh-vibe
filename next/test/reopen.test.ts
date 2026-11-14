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

  it('keeps the same map when nothing settled, so React does not re-render for nothing', () => {
    const r = startReopening(new Map(), closedId, NOW);
    expect(settleReopening(r, snap(), NOW + 1_000)).toBe(r);
  });
});
