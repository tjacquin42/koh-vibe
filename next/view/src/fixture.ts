import type { Snapshot } from '../../src/shared/protocol';

/**
 * Sample data for the browser preview (the page opened straight from Vite,
 * outside the editor). Invented on purpose: nothing here is read from disk.
 */
export function sampleSnapshot(now: number): Snapshot {
  const ago = (min: number): number => now - min * 60_000;
  const later = (min: number): number => now + min * 60_000;
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
        startedAt: ago(40),
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
        startedAt: ago(18),
        currentAction: { tool: 'Edit', target: 'src/dates.ts' },
        tokens: { input: 64_000, output: 3_100 },
      },
      { id: 's3', title: 'Write the release notes', project: 'docs', status: 'done_unseen', origin: 'vscode', toolCount: 6, lastEventAt: ago(12) },
      { id: 's4', project: 'scratch', status: 'idle', origin: 'desktop', toolCount: 0, lastEventAt: ago(21 * 60), expiresAt: later(3 * 60) },
      { id: 's5', title: 'Audit the dependencies', project: 'api', status: 'idle', origin: 'vscode', toolCount: 22, lastEventAt: ago(300), endedAt: ago(240) },
    ],
    folders: [
      { id: 'f1', name: 'Shop', color: 'orange', sessionIds: ['s1', 's3'] },
      { id: 'f2', name: 'Backend', color: 'blue', sessionIds: ['s2', 's5'] },
    ],
    unfiled: ['s4'],
    usage: {
      at: ago(1),
      source: 'api',
      fiveHour: { percent: 42, resetsAt: later(134) },
      weekly: { percent: 18, resetsAt: later(3 * 24 * 60) },
      models: [{ name: 'Opus', percent: 88, resetsAt: later(3 * 24 * 60) }],
    },
    artifacts: {
      at: ago(3),
      items: [
        { slug: 'a1', title: 'Release plan', pinned: true, updatedAt: ago(40), project: 'shop-front' },
        { slug: 'a2', title: 'API error budget', pinned: false, updatedAt: ago(90), project: 'api' },
        { slug: 'a3', title: 'Holiday menu ideas', pinned: false, updatedAt: ago(60 * 26) },
      ],
    },
    routines: {
      at: ago(3),
      items: [
        { id: 'r1', name: 'Morning digest', enabled: true, nextRunAt: later(600), group: 'tomorrow', cron: '0 7 * * *', repos: ['me/digest'] },
        { id: 'r2', name: 'Dependency check', enabled: false, group: 'paused', cron: '0 9 * * 1', repos: [] },
      ],
    },
    closed: [{ sessionId: 'c1', title: 'Try the new router', project: 'shop-front', closedAt: ago(80) }],
    settings: { animate: true, persistent: true, expireTemporary: true, volume: 60, waiting: 'Glass', done: 'Pop' },
    processes: {
      at: now,
      bySession: {
        s2: [
          { pid: 4120, label: 'node mcp-server.js', kind: 'mcp', elapsed: 1080, rss: 82_000, depth: 0 },
          { pid: 4388, label: 'pnpm test --watch', kind: 'shell', elapsed: 300, rss: 12_000, depth: 0 },
          { pid: 4390, label: 'vitest', kind: 'work', elapsed: 298, rss: 240_000, depth: 1 },
        ],
      },
      orphans: [{ cwd: '/work/shop-front', tree: [{ pid: 3001, label: 'vite --port 5173', kind: 'work', elapsed: 7200, rss: 150_000, depth: 0 }] }],
    },
  };
}
