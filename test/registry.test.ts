import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRegistryEntry, processAlive, readLiveSessions } from '../src/claude/registry';

// The shape Claude Code 2.1.x writes to `~/.claude/sessions/<pid>.json`, as
// observed on a real machine (paths and ids neutralised). Everything past the
// first five fields is noise to us, and must stay noise: a field added or
// removed by a future version must not change what we read.
const OBSERVED = {
  pid: 18789,
  sessionId: '9734f15a-0f40-47b1-aca4-290f307cfe0f',
  cwd: '/Users/dev/projet',
  startedAt: 1787740794995,
  procStart: 'Wed Aug 26 10:39:54 2026',
  version: '2.1.245',
  peerProtocol: 1,
  peerFeatures: ['notify_idle', 'artifact_yield'],
  kind: 'interactive',
  entrypoint: 'claude-vscode',
  messagingSocketPath: '/tmp/cc-socks/18789.sock',
  name: 'dev-3b',
  nameSource: 'derived',
  nameSince: 1787740794995,
};

describe('parseRegistryEntry', () => {
  it('reads the five fields that matter out of the observed shape', () => {
    expect(parseRegistryEntry(JSON.stringify(OBSERVED))).toEqual({
      pid: 18789,
      sessionId: '9734f15a-0f40-47b1-aca4-290f307cfe0f',
      cwd: '/Users/dev/projet',
      entrypoint: 'claude-vscode',
      startedAt: 1787740794995,
    });
  });

  it('rejects anything that is not a record with a usable pid, id and cwd', () => {
    expect(parseRegistryEntry('not json')).toBeUndefined();
    expect(parseRegistryEntry('[]')).toBeUndefined();
    expect(parseRegistryEntry(JSON.stringify({ ...OBSERVED, pid: undefined }))).toBeUndefined();
    expect(parseRegistryEntry(JSON.stringify({ ...OBSERVED, pid: 12.5 }))).toBeUndefined();
    expect(parseRegistryEntry(JSON.stringify({ ...OBSERVED, pid: -1 }))).toBeUndefined();
    expect(parseRegistryEntry(JSON.stringify({ ...OBSERVED, pid: '18789' }))).toBeUndefined();
    expect(parseRegistryEntry(JSON.stringify({ ...OBSERVED, sessionId: undefined }))).toBeUndefined();
    expect(parseRegistryEntry(JSON.stringify({ ...OBSERVED, cwd: '' }))).toBeUndefined();
  });

  it('applies the spool rule to the session id: it ends up in a file name and on a command line', () => {
    expect(parseRegistryEntry(JSON.stringify({ ...OBSERVED, sessionId: '../etc' }))).toBeUndefined();
    expect(parseRegistryEntry(JSON.stringify({ ...OBSERVED, sessionId: 'a b' }))).toBeUndefined();
  });

  it('tolerates a missing entrypoint or start time rather than dropping the session', () => {
    const { entrypoint: _e, startedAt: _s, ...bare } = OBSERVED;
    const entry = parseRegistryEntry(JSON.stringify(bare));
    expect(entry?.entrypoint).toBe('');
    expect(entry).not.toHaveProperty('startedAt');
    expect(parseRegistryEntry(JSON.stringify({ ...bare, startedAt: 'yesterday' }))).not.toHaveProperty('startedAt');
  });
});

describe('readLiveSessions', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'koh-registry-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const entry = (pid: number, sessionId: string, extra: Record<string, unknown> = {}): void => {
    writeFileSync(join(dir, `${pid}.json`), JSON.stringify({ ...OBSERVED, pid, sessionId, ...extra }), 'utf8');
  };

  it('keys the live entries by session id and drops the ones whose process is gone', async () => {
    entry(100, 'alive-1');
    entry(200, 'dead-2');
    const live = await readLiveSessions(dir, (pid) => pid === 100);
    expect([...live.keys()]).toEqual(['alive-1']);
    expect(live.get('alive-1')?.pid).toBe(100);
  });

  it('ignores the key files, unreadable entries and anything that is not a .json', async () => {
    entry(100, 'alive-1');
    writeFileSync(join(dir, '100.abcdef.key'), 'secret', 'utf8');
    writeFileSync(join(dir, '300.json'), '{ broken', 'utf8');
    writeFileSync(join(dir, 'notes.txt'), '{}', 'utf8');
    const live = await readLiveSessions(dir, () => true);
    expect([...live.keys()]).toEqual(['alive-1']);
  });

  it('reads a missing directory as "nobody alive", never as an error', async () => {
    await expect(readLiveSessions(join(dir, 'absent'), () => true)).resolves.toEqual(new Map());
  });

  it('keeps the most recently started process when two entries claim the same session', async () => {
    entry(100, 'same', { startedAt: 1_000 });
    entry(200, 'same', { startedAt: 2_000 });
    entry(300, 'same', { startedAt: 1_500 });
    const live = await readLiveSessions(dir, () => true);
    expect(live.get('same')?.pid).toBe(200);
  });

  it('never throws on a directory it cannot list', async () => {
    mkdirSync(join(dir, 'nodir'));
    // A file where a directory is expected: readdir fails with ENOTDIR.
    writeFileSync(join(dir, 'file'), '', 'utf8');
    await expect(readLiveSessions(join(dir, 'file'), () => true)).resolves.toEqual(new Map());
  });
});

describe('processAlive', () => {
  it('sees this very process', () => {
    expect(processAlive(process.pid)).toBe(true);
  });

  it('does not see a pid no system hands out', () => {
    // Above every platform's pid ceiling (macOS stops at 99998, Linux at
    // 4194304 by default): kill(2) answers ESRCH, never a real process.
    expect(processAlive(99_999_999)).toBe(false);
  });
});
