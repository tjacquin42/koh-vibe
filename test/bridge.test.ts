import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BRIDGE = join(process.cwd(), 'bin/koh-vibe-bridge');
let home: string;

/**
 * `spawnSync` plutôt qu'`execFileSync` : quand le spool n'existe pas, le pont
 * sort AVANT d'avoir lu son entrée (c'est le comportement voulu), et le parent
 * reçoit alors EPIPE en écrivant dans un tuyau déjà fermé. `execFileSync` en
 * faisait une exception — un test rouge par intermittence, pour un pont qui se
 * comportait exactement comme il doit. Ici l'EPIPE est ce qu'il est : une course
 * du côté de l'appelant, sans rapport avec le code de retour qu'on vérifie.
 */
function run(event: string, stdin: string, env: Record<string, string> = {}): number {
  const res = spawnSync(BRIDGE, [event], {
    input: stdin,
    env: { ...process.env, KOH_VIBE_HOME: home, ...env },
    encoding: 'utf8',
  });
  if (res.error !== undefined && (res.error as NodeJS.ErrnoException).code !== 'EPIPE') throw res.error;
  expect(res.stdout).toBe(''); // rien sur stdout, jamais
  return res.status ?? 0;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'koh-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('koh-vibe-bridge', () => {
  it('drops one file per event, payload untouched', () => {
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

  it('zero-pads the pid in the filename, so lexicographic order does not depend on its width', () => {
    // Deux événements de la même milliseconde ne sont distingués que par le
    // tri du nom de fichier une fois le champ horodatage égal ; un pid non
    // zero-paddé trie "9" après "10" alors que 9 < 10. Un pid de largeur fixe
    // ferme cette ambiguïté, quelle que soit la valeur réelle du pid.
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

  it('exits 0 when the spool does not exist', () => {
    expect(run('Stop', '{"session_id":"abc","cwd":"/tmp/p"}')).toBe(0);
  });

  it('exits 0 when the spool is read-only', () => {
    const events = join(home, 'events');
    mkdirSync(events, { recursive: true });
    chmodSync(events, 0o500);
    expect(run('Stop', '{"session_id":"abc","cwd":"/tmp/p"}')).toBe(0);
    chmodSync(events, 0o700);
  });

  it('never disturbs the Claude Code session that calls it: nothing on stderr even when the spool is not writable (M1)', () => {
    // execFileSync ne donne accès à stderr qu'en cas d'échec : spawnSync le
    // capture toujours, sans dépendre du code de retour.
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
