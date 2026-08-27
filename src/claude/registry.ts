import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidSessionId } from '../events/parse';

/**
 * A Claude Code process that is running right now, as its own registry
 * describes it.
 *
 * Claude Code 2.1.x writes `~/.claude/sessions/<pid>.json` for every
 * interactive session — pid, session id, working directory, entrypoint, start
 * time and a few fields of no use here — and removes it on a clean exit. The
 * file is undocumented, so it is read defensively: anything malformed is
 * ignored, and a process that is gone (a `kill -9` leaves the file behind) is
 * ignored too. What is left is the one thing the hooks cannot tell us: that a
 * conversation is still alive even though it has been silent for a day.
 */
export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  /** `CLAUDE_CODE_ENTRYPOINT` of the process; empty when the entry has none. */
  entrypoint: string;
  /** When the process started, epoch milliseconds. Absent when unreadable. */
  startedAt?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Validates one registry file. `undefined` for anything not usable: a future
 * version of Claude Code changing the shape must cost us the registry, never
 * an exception in the drain.
 *
 * The session id goes through the very rule the spool applies
 * (`isValidSessionId`): it ends up in a file name (`sessions/<id>.json`) and,
 * for a terminal conversation, on a command line.
 */
export function parseRegistryEntry(raw: string): LiveSession | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(json)) return undefined;
  const pid = json['pid'];
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return undefined;
  const sessionId = str(json['sessionId']);
  const cwd = str(json['cwd']);
  if (sessionId === undefined || !isValidSessionId(sessionId) || cwd === undefined) return undefined;
  const entry: LiveSession = { pid, sessionId, cwd, entrypoint: str(json['entrypoint']) ?? '' };
  const startedAt = json['startedAt'];
  if (typeof startedAt === 'number' && Number.isFinite(startedAt)) entry.startedAt = startedAt;
  return entry;
}

/**
 * Whether a process exists. Signal 0 delivers nothing and only checks: ESRCH
 * means no such process; EPERM means one exists that we may not signal — it
 * is alive, which is all that is asked here.
 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && 'code' in err && err.code === 'EPERM';
  }
}

/**
 * The sessions whose process is running, keyed by session id.
 *
 * A missing or unlistable directory is an empty map, not an error: an older
 * Claude Code keeps no registry, and the callers fall back to what they did
 * before it existed. When two processes claim the same session — a
 * conversation resumed twice, a pid reused before its file was overwritten —
 * the most recently started one is the one that is real.
 *
 * `isAlive` is injectable so that tests can decide which pids exist without
 * spawning anything.
 */
export async function readLiveSessions(
  dir: string,
  isAlive: (pid: number) => boolean = processAlive,
): Promise<Map<string, LiveSession>> {
  const out = new Map<string, LiveSession>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let raw: string;
    try {
      raw = await readFile(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    const entry = parseRegistryEntry(raw);
    if (entry === undefined || !isAlive(entry.pid)) continue;
    const known = out.get(entry.sessionId);
    if (known === undefined || (entry.startedAt ?? 0) > (known.startedAt ?? 0)) out.set(entry.sessionId, entry);
  }
  return out;
}
