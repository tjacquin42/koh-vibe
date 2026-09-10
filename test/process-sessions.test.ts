import { describe, expect, it } from 'vitest';
import { processesBySession } from '../src/process/sessions';
import { parsePs } from '../src/process/scan';
import type { LiveSession } from '../src/claude/registry';

const SNAPSHOT = '/Users/jack/.claude/shell-snapshots/snap.sh';

const ROWS = parsePs(
  [
    '100   1  10 1000 /path/to/claude',
    '200 100  10 1000 /opt/homebrew/bin/uv tool uvx alpaca-mcp-server',
    `300 100  10 1000 /bin/zsh -c source ${SNAPSHOT} && eval 'pnpm dev' < /dev/null`,
    '400 300  10 1000 node vite',
    '500   1  10 1000 /path/to/claude',
    '600 500  10 1000 sqld --http-listen-addr 127.0.0.1:8080',
  ].join('\n'),
);

function live(entries: readonly [string, number][]): Map<string, LiveSession> {
  return new Map(
    entries.map(([sessionId, pid]) => [sessionId, { pid, sessionId, cwd: '/tmp', entrypoint: 'claude-vscode' }]),
  );
}

describe('processesBySession', () => {
  it('gives each session the subtree of its own process', () => {
    const found = processesBySession(ROWS, live([['a', 100], ['b', 500]]));
    expect(found.get('a')?.map((p) => p.pid)).toEqual([200, 300, 400]);
    expect(found.get('b')?.map((p) => p.pid)).toEqual([600]);
  });

  it('leaves out a session that started nothing rather than mapping it to an empty list', () => {
    // An entry with an empty array would make every caller check the length as
    // well as the presence. Absent means the same thing and reads once.
    expect(processesBySession(ROWS, live([['c', 999]])).has('c')).toBe(false);
  });

  it('has nothing to give when the registry is empty', () => {
    expect(processesBySession(ROWS, new Map()).size).toBe(0);
  });

  it('has nothing to give when ps returned nothing', () => {
    expect(processesBySession([], live([['a', 100]])).size).toBe(0);
  });
});
