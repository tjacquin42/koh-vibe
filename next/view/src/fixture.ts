import type { Snapshot } from '../../src/shared/protocol';

/**
 * Sample data for the browser preview (the page opened straight from Vite,
 * outside the editor). Invented on purpose: nothing here is read from disk.
 */
export function sampleSnapshot(now: number): Snapshot {
  const ago = (min: number): number => now - min * 60_000;
  return {
    at: now,
    sessions: [
      {
        id: 's1',
        title: 'Rename the export button',
        project: 'shop-front',
        branch: 'feat/export',
        status: 'waiting',
        origin: 'vscode',
        toolCount: 14,
        lastEventAt: ago(2),
        pendingPermission: { tool: 'Bash', summary: 'pnpm test' },
        tokens: { input: 182_400, output: 9_800 },
      },
      {
        id: 's2',
        title: 'Fix the flaky date test',
        project: 'api',
        branch: 'fix/dates',
        status: 'running',
        origin: 'terminal',
        toolCount: 31,
        lastEventAt: ago(0),
        currentAction: { tool: 'Edit', target: 'src/dates.ts' },
      },
      { id: 's3', title: 'Write the release notes', project: 'docs', status: 'done_unseen', origin: 'vscode', toolCount: 6, lastEventAt: ago(12) },
      { id: 's4', project: 'scratch', status: 'idle', origin: 'desktop', toolCount: 0, lastEventAt: ago(95) },
      { id: 's5', title: 'Audit the dependencies', project: 'api', status: 'idle', origin: 'vscode', toolCount: 22, lastEventAt: ago(300), endedAt: ago(240) },
    ],
    folders: [
      { id: 'f1', name: 'Shop', color: 'orange', sessionIds: ['s1', 's3'] },
      { id: 'f2', name: 'Backend', color: 'blue', sessionIds: ['s2', 's5'] },
    ],
    unfiled: ['s4'],
    usage: { at: ago(1), source: 'api', fiveHour: { percent: 42, resetsAt: now + 134 * 60_000 }, weekly: { percent: 18 } },
    artifacts: { at: ago(3), items: [{ slug: 'a1', title: 'Release plan', pinned: true, updatedAt: ago(40) }] },
    routines: { at: ago(3), items: [{ id: 'r1', name: 'Morning digest', enabled: true, nextRunAt: now + 600 * 60_000 }] },
    closed: [],
  };
}
