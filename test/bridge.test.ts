import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BRIDGE = join(process.cwd(), 'bin/koh-vibe-bridge');
let home: string;

/**
 * `spawnSync` rather than `execFileSync`: when the spool does not exist, the
 * bridge exits BEFORE reading its input (that is the intended behavior),
 * and the parent then gets EPIPE writing into an already-closed pipe.
 * `execFileSync` turned that into an exception — an intermittently red
 * test, for a bridge that behaved exactly as it should. Here the EPIPE is
 * what it is: a race on the caller's side, unrelated to the exit code being
 * checked.
 */
function run(event: string, stdin: string, env: Record<string, string> = {}): number {
  const res = spawnSync(BRIDGE, [event], {
    input: stdin,
    env: { ...process.env, KOH_VIBE_HOME: home, ...env },
    encoding: 'utf8',
  });
  if (res.error !== undefined && (res.error as NodeJS.ErrnoException).code !== 'EPIPE') throw res.error;
  expect(res.stdout).toBe(''); // nothing on stdout, ever
  return res.status ?? 0;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'koh-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('koh-vibe-bridge', () => {
  it('drops one file per event, payload intact', () => {
    mkdirSync(join(home, 'events'), { recursive: true });
    run('PreToolUse', '{"session_id":"abc","cwd":"/tmp/p","tool_name":"Bash"}', {
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      TERM_PROGRAM: 'ghostty',
    });
    const files = readdirSync(join(home, 'events')).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const written: unknown = JSON.parse(readFileSync(join(home, 'events', files[0]!), 'utf8'));
    expect(written).toMatchObject({
      event: 'PreToolUse',
      entrypoint: 'cli',
      termProgram: 'ghostty',
      payload: { session_id: 'abc', cwd: '/tmp/p', tool_name: 'Bash' },
    });
  });

  it('zero-pads the pid in the file name, so lexicographic sort does not depend on its width', () => {
    // Two events from the same millisecond are only distinguished by the
    // file name's sort once the timestamp field is equal; a non-zero-padded
    // pid sorts "9" after "10" even though 9 < 10. A fixed-width pid closes
    // that ambiguity, whatever the pid's actual value.
    mkdirSync(join(home, 'events'), { recursive: true });
    run('Stop', '{"session_id":"abc","cwd":"/tmp/p"}');
    const files = readdirSync(join(home, 'events')).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const match = /^\d{13}-(\d+)-Stop\.json$/.exec(files[0]!);
    expect(match).not.toBeNull();
    expect(match?.[1]).toHaveLength(10);
  });

  it('leaves no temporary file behind', () => {
    mkdirSync(join(home, 'events'), { recursive: true });
    run('Stop', '{"session_id":"abc","cwd":"/tmp/p"}');
    expect(readdirSync(join(home, 'events')).filter((f) => f.startsWith('.tmp'))).toHaveLength(0);
  });

  it('exits with 0 when the spool does not exist', () => {
    expect(run('Stop', '{"session_id":"abc","cwd":"/tmp/p"}')).toBe(0);
  });

  it('exits with 0 when the spool is read-only', () => {
    const events = join(home, 'events');
    mkdirSync(events, { recursive: true });
    chmodSync(events, 0o500);
    expect(run('Stop', '{"session_id":"abc","cwd":"/tmp/p"}')).toBe(0);
    chmodSync(events, 0o700);
  });

  it("never disturbs the Claude Code session calling it: nothing on stderr even when the spool is not writable (M1)", () => {
    // execFileSync only gives access to stderr on failure: spawnSync
    // captures it always, regardless of the exit code.
    const events = join(home, 'events');
    mkdirSync(events, { recursive: true });
    chmodSync(events, 0o500);
    const res = spawnSync(BRIDGE, ['Stop'], {
      input: '{"session_id":"abc","cwd":"/tmp/p"}',
      env: { ...process.env, KOH_VIBE_HOME: home },
      encoding: 'utf8',
    });
    chmodSync(events, 0o700);

    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
    expect(res.stderr).toBe('');
  });
});
