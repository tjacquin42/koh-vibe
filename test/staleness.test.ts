import { describe, expect, it } from 'vitest';
import { STALE_IN_FLIGHT_MS, STALE_SILENT_MS, withStaleness } from '../src/store/staleness';
import type { Session } from '../src/events/types';

const base: Session = {
  id: 's', cwd: '/x', project: 'x', origin: 'vscode',
  status: 'running', toolCount: 0, lastEventAt: 0,
};

describe('withStaleness', () => {
  it('stales a session that is working and silent', () => {
    expect(withStaleness(base, STALE_SILENT_MS + 1).status).toBe('stale');
  });

  it('does not stale before the delay', () => {
    expect(withStaleness(base, STALE_SILENT_MS - 1).status).toBe('running');
  });

  it('suspends staling while a tool is in flight', () => {
    const inFlight: Session = { ...base, inFlightSince: 0 };
    expect(withStaleness(inFlight, STALE_SILENT_MS + 1).status).toBe('running');
  });

  it('stales anyway beyond the ceiling', () => {
    const inFlight: Session = { ...base, inFlightSince: 0 };
    expect(withStaleness(inFlight, STALE_IN_FLIGHT_MS + 1).status).toBe('stale');
  });

  it('does not touch the other statuses', () => {
    for (const status of ['waiting', 'done_unseen', 'idle', 'stale'] as const) {
      expect(withStaleness({ ...base, status }, STALE_IN_FLIGHT_MS * 10).status).toBe(status);
    }
  });
});
