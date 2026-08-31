import { describe, expect, it } from 'vitest';
import {
  closedDescription,
  closedTooltip,
  formatAge,
  formatAgeCoarse,
  formatTokens,
  sessionDescription,
  sessionLabel,
  sessionTooltip,
  statusLabel,
} from '../src/ui/labels';
import type { Session } from '../src/events/types';
import type { ClosedEntry } from '../src/closed/model';

const s: Session = {
  id: 'abc', cwd: '/Users/dev/projet/.worktrees/feat-seo',
  project: 'projet', branch: 'feat-seo', origin: 'vscode',
  status: 'running', toolCount: 47, lastEventAt: 0,
  currentAction: { tool: 'Edit', target: '/Users/dev/projet/web/nuxt.config.ts' },
  tokens: { input: 128_000, output: 4_200 },
};

describe('labels', () => {
  it('names the five statuses', () => {
    expect(statusLabel('running')).toBe('running');
    expect(statusLabel('waiting')).toBe('waiting for you');
    expect(statusLabel('done_unseen')).toBe('done');
    expect(statusLabel('idle')).toBe('idle');
    expect(statusLabel('stale')).toBe('stale');
  });

  it('formats durations short', () => {
    expect(formatAge(5_000)).toBe('5 s');
    expect(formatAge(90_000)).toBe('1 min');
    expect(formatAge(3 * 3_600_000)).toBe('3 h');
  });

  it('formats the tokens', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(128_000)).toBe('128k');
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });

  it('never produces "1000k" at the boundaries', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_000)).toBe('1k');
    expect(formatTokens(999_499)).toBe('999k');
    expect(formatTokens(999_500)).toBe('1.0M');
    expect(formatTokens(1_000_000)).toBe('1.0M');
  });

  it('labels the session with project and branch when there is no title', () => {
    expect(sessionLabel(s)).toBe('projet · feat-seo');
    expect(sessionLabel({ ...s, branch: undefined })).toBe('projet');
  });

  it('shows the conversation title when there is one', () => {
    expect(sessionLabel({ ...s, title: '#Koh-Vibe' })).toBe('#Koh-Vibe');
  });

  it('falls back to project · branch with no title', () => {
    expect(sessionLabel({ ...s, title: undefined })).toBe('projet · feat-seo');
  });

  it('the project stays readable in the description once a title takes the label', () => {
    const d = sessionDescription({ ...s, title: '#Koh-Vibe', currentAction: undefined }, s.lastEventAt);
    expect(d).toContain('projet');
  });

  it('describes the current action by the filename alone', () => {
    expect(sessionDescription(s, 0)).toBe('Edit nuxt.config.ts');
  });

  it('describes the permission being waited on first', () => {
    const waiting: Session = {
      ...s, status: 'waiting', pendingPermission: { tool: 'Bash', summary: 'rm -rf dist' },
    };
    expect(sessionDescription(waiting, 0)).toBe('permission: rm -rf dist');
  });

  it('falls back to the age alone when nothing is happening — the dot says the status', () => {
    expect(sessionDescription({ ...s, status: 'idle', currentAction: undefined }, 60_000)).toBe('1 min');
  });

  it('never spells the status out in the description', () => {
    // Le mot ferait doublon avec la pastille ; il reste dans l infobulle.
    for (const status of ['running', 'waiting', 'done_unseen', 'idle', 'stale'] as const) {
      const d = sessionDescription({ ...s, status, currentAction: undefined }, 0);
      expect(d).not.toContain(statusLabel(status));
    }
  });

  it('keeps the status spelled out in the tooltip', () => {
    expect(sessionTooltip({ ...s, status: 'waiting' }, 0)).toContain(statusLabel('waiting'));
  });
});

describe('formatAgeCoarse', () => {
  it('stays stable through the whole first minute', () => {
    // C est cette stabilité qui permet à la vue de ne PAS se reconstruire toutes
    // les deux secondes, et donc à une infobulle de rester ouverte.
    for (const ms of [0, 1_000, 30_000, 59_999]) {
      expect(formatAgeCoarse(ms)).toBe('just now');
    }
  });

  it('joins minute precision beyond that', () => {
    expect(formatAgeCoarse(60_000)).toBe('1 min');
    expect(formatAgeCoarse(3_600_000)).toBe('1 h');
  });

  it('lets the tooltip keep second precision', () => {
    expect(formatAge(30_000)).toBe('30 s');
  });
});

describe('closed conversations', () => {
  const closed = (over: Partial<ClosedEntry> = {}): ClosedEntry => ({
    id: 'a',
    cwd: '/Users/dev/projet',
    project: 'projet',
    origin: 'vscode',
    closedAt: 0,
    ...over,
  });

  it('labels a closed conversation by the same rule as a live one', () => {
    expect(sessionLabel(closed({ title: 'Ajouter la corbeille' }))).toBe('Ajouter la corbeille');
    expect(sessionLabel(closed({ branch: 'feat-x' }))).toBe('projet · feat-x');
    expect(sessionLabel(closed())).toBe('projet');
  });

  it('describes only the age when there is no title — the label already says where, via sessionLabel', () => {
    // Mirrors sessionDescription's own rule: repeating "project · branch" here
    // too would make the row read "projet, projet · closed 3 min" once label
    // and description are read together (accessibilityInformation).
    expect(closedDescription(closed({ branch: 'feat-x' }), 120_000)).toBe('closed 2 min');
  });

  it('stays stable through the first minute, like the live rows', () => {
    expect(closedDescription(closed(), 5_000)).toBe('closed just now');
  });

  it('prepends where it worked once a title has taken over the label, like a live row', () => {
    expect(closedDescription(closed({ branch: 'feat-x', title: 'Titre' }), 120_000)).toBe(
      'projet · feat-x · closed 2 min',
    );
    expect(closedDescription(closed({ title: 'Titre' }), 120_000)).toBe('projet · closed 2 min');
  });

  it('tells the origin and how to bring it back in the tooltip', () => {
    const lines = closedTooltip(closed({ branch: 'feat-x' }), 60_000).split('\n');
    expect(lines[0]).toBe('projet / feat-x');
    expect(lines).toContain('origin: vscode');
    expect(lines).toContain('Click to reopen');
    expect(lines.at(-1)).toBe('/Users/dev/projet');
  });

  it('tells the origin and how to bring it back in the tooltip, without a branch', () => {
    const lines = closedTooltip(closed(), 60_000).split('\n');
    expect(lines[0]).toBe('projet');
    expect(lines).toContain('origin: vscode');
    expect(lines).toContain('Click to reopen');
    expect(lines.at(-1)).toBe('/Users/dev/projet');
  });

  it('does not promise reopening for an origin reopenPlan can only explain, never reopen', () => {
    for (const origin of ['sdk', 'unknown'] as const) {
      const lines = closedTooltip(closed({ origin }), 60_000).split('\n');
      expect(lines).not.toContain('Click to reopen');
    }
  });
});
