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
        { id: 'r1', name: 'Morning digest', enabled: true, nextRunAt: later(600), group: 'tomorrow', cron: '0 7 * * *', repos: ['me/digest'], spent: false },
        { id: 'r2', name: 'Dependency check', enabled: false, group: 'paused', cron: '0 9 * * 1', repos: [], spent: false },
      ],
    },
    closed: [
      { sessionId: 'c1', title: 'Try the new router', project: 'shop-front', closedAt: ago(80), resumable: true },
      { sessionId: 'c2', title: 'Nightly import script', project: 'data-jobs', closedAt: ago(300), resumable: false },
    ],
    settings: { animate: true, persistent: true, expireTemporary: true, volume: 60, waiting: 'Glass', done: 'Pop' },
    activity: {
      at: now,
      since: now - 24 * 60 * 60_000,
      sessions: [
        {
          id: 's2',
          title: 'Fix the flaky date test',
          project: 'api',
          tokens: { input: 4_000, output: 61_000, cacheWrite: 420_000, cacheRead: 9_800_000 },
          subagentTokens: { input: 900, output: 12_000, cacheWrite: 90_000, cacheRead: 2_100_000 },
          subagents: 2,
          busy: [[ago(300), ago(240)], [ago(95), ago(70)], [ago(18), now]],
          tail: [
            { at: ago(18), sessionId: 's2', kind: 'prompt', text: 'The date test fails once in ten, find out why', subagent: false },
            { at: ago(12), sessionId: 's2', kind: 'tool', tool: 'Read', text: 'dates.test.ts', subagent: false },
            { at: ago(6), sessionId: 's2', kind: 'text', text: 'The test builds its date in local time and compares in UTC.', subagent: false },
            { at: ago(1), sessionId: 's2', kind: 'tool', tool: 'Edit', text: 'dates.ts', subagent: false },
          ],
          lastAt: ago(0),
        },
        {
          id: 's1',
          title: 'Rename the export button',
          project: 'shop-front',
          tokens: { input: 2_000, output: 30_000, cacheWrite: 210_000, cacheRead: 4_200_000 },
          subagentTokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
          subagents: 0,
          busy: [[ago(200), ago(150)], [ago(40), ago(2)]],
          tail: [
            { at: ago(40), sessionId: 's1', kind: 'prompt', text: 'Rename “Export” to “Download” everywhere', subagent: false },
            { at: ago(10), sessionId: 's1', kind: 'tool', tool: 'Grep', text: 'Export', subagent: false },
            { at: ago(2), sessionId: 's1', kind: 'tool', tool: 'Bash', text: 'pnpm test', subagent: false },
          ],
          lastAt: ago(2),
        },
        {
          id: 's3',
          title: 'Write the release notes',
          project: 'docs',
          tokens: { input: 600, output: 9_000, cacheWrite: 60_000, cacheRead: 700_000 },
          subagentTokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
          subagents: 0,
          busy: [[ago(30), ago(12)]],
          tail: [{ at: ago(12), sessionId: 's3', kind: 'text', text: 'The notes are in CHANGELOG.md.', subagent: false }],
          lastAt: ago(12),
        },
      ],
      feed: [
        { at: ago(1), sessionId: 's2', kind: 'tool', tool: 'Edit', text: 'dates.ts', subagent: false },
        { at: ago(2), sessionId: 's1', kind: 'tool', tool: 'Bash', text: 'pnpm test', subagent: false },
        { at: ago(4), sessionId: 's2', kind: 'tool', tool: 'Grep', text: 'toISOString', subagent: true },
        { at: ago(6), sessionId: 's2', kind: 'text', text: 'The test builds its date in local time and compares in UTC.', subagent: false },
        { at: ago(10), sessionId: 's1', kind: 'tool', tool: 'Grep', text: 'Export', subagent: false },
        { at: ago(12), sessionId: 's3', kind: 'text', text: 'The notes are in CHANGELOG.md.', subagent: false },
        { at: ago(18), sessionId: 's2', kind: 'prompt', text: 'The date test fails once in ten, find out why', subagent: false },
      ],
    },
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
