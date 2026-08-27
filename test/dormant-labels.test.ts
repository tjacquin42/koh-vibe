import { describe, expect, it } from 'vitest';
import { sessionDescription, sessionTooltip } from '../src/ui/labels';
import type { Session } from '../src/events/types';

const dormant: Session = {
  id: 's', cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode', status: 'idle',
  toolCount: 0, lastEventAt: 0, title: 'Telegram Alert', dormant: true,
};

describe('labels — a dormant tab', () => {
  it('says the tab was never started rather than counting an age that means nothing', () => {
    const now = 1_700_000_000_000;
    expect(sessionDescription(dormant, now)).toBe('projet · tab asleep');
    expect(sessionTooltip(dormant, now)).toContain('tab asleep');
    expect(sessionTooltip(dormant, now)).toContain('click to wake it');
    expect(sessionTooltip(dormant, now)).not.toMatch(/\d+ h/);
  });
});
