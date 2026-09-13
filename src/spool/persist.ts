import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpoolDirs } from '../paths';
import type { Origin, Session, Status } from '../events/types';
import { isErrnoException } from '../lib/errno';

// Record<Status, true> and Record<Origin, true>: if the union gains a member on
// events/types.ts's side without these tables being updated, compilation fails —
// the type guard cannot silently drift from Session's contract.
const STATUSES: Record<Status, true> = {
  running: true,
  waiting: true,
  done_unseen: true,
  idle: true,
};
const ORIGINS: Record<Origin, true> = {
  vscode: true,
  terminal: true,
  desktop: true,
  sdk: true,
  unknown: true,
};

export async function ensureDirs(dirs: SpoolDirs): Promise<void> {
  for (const dir of [dirs.events, dirs.sessions, dirs.requests, dirs.rejected, dirs.backups]) {
    await mkdir(dir, { recursive: true });
  }
}

// `process.pid` alone is not unique per call: this function is exported
// and reusable, nothing guarantees a caller serializes it (today
// SpoolWatcher.tick() does, but that is a property of the caller, not of
// the function). Same synchronous counter as `appendLocalEvent`.
let writeSessionSeq = 0;

/**
 * What a session leaves on disk.
 *
 * `dormant` is not a state of the conversation: it is what THIS window
 * knows about its tab, recomputed on every render from the editor's memento
 * (claude/dormant.ts). Written, it would outlive the closing of the tab it
 * describes, and the conversation would remain forever "a restored tab": a
 * click would try to bring to the front a tab that no longer exists, and
 * it would become impossible to reopen.
 *
 * The rule is enforced at the gates — the two functions that write and the
 * two that read — rather than at the callers: it takes only one that
 * forgets, and that has happened. Applying it on read too heals files that
 * an earlier version had already marked, instead of waiting for a manual
 * repair.
 */
function persisted(s: Session): Session {
  const { dormant: _perWindow, ...rest } = s;
  return rest;
}

/**
 * Atomic write: a concurrent reader sees the old file or the new one,
 * never a half-written file.
 */
export async function writeSession(dirs: SpoolDirs, s: Session): Promise<void> {
  const seq = (writeSessionSeq += 1);
  const target = join(dirs.sessions, `${s.id}.json`);
  const tmp = join(dirs.sessions, `.tmp-${s.id}-${process.pid}-${seq}`);
  await writeFile(tmp, JSON.stringify(persisted(s)), 'utf8');
  await rename(tmp, target);
}

/**
 * Writes a session ONLY if none exists under that id, and says whether it did.
 *
 * `writeSession` replaces; this one refuses. It is what a rescan needs: the
 * file may appear between "is it there?" and "then write it" — a drain in
 * another window reducing a hook of that very session — and replacing it
 * would trade a real state (running, seven tools in) for an idle skeleton.
 * `link` is the atomic exclusive create: the target either appears complete
 * or not at all, and EEXIST is the honest answer rather than an error. The
 * temporary file is removed either way.
 */
export async function createSession(dirs: SpoolDirs, s: Session): Promise<boolean> {
  const seq = (writeSessionSeq += 1);
  const target = join(dirs.sessions, `${s.id}.json`);
  const tmp = join(dirs.sessions, `.tmp-${s.id}-${process.pid}-${seq}`);
  await writeFile(tmp, JSON.stringify(persisted(s)), 'utf8');
  try {
    await link(tmp, target);
    return true;
  } catch (err) {
    if (isErrnoException(err) && err.code === 'EEXIST') return false;
    throw err;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/**
 * Marks a session hidden, in place, and says whether there was one to mark.
 *
 * Hidden rather than removed: a removed file is exactly what the rescan looks
 * for, and the row would be back on the next pass — while the process it
 * describes still runs. The flag survives on disk until a hook clears it
 * (`reduce`) or `SessionEnd` removes the file.
 */
export async function hideSession(dirs: SpoolDirs, id: string): Promise<boolean> {
  const current = await readSession(dirs, id);
  if (current === undefined) return false;
  await writeSession(dirs, { ...current, hidden: true });
  return true;
}

/**
 * Keeps at most `max` ended conversations — the most recently ended ones —
 * and removes the rest. Open conversations are never candidates. Each
 * candidate is re-read just before removal, like every decision in this
 * module: an entry brought back to life meanwhile is not an ended one any
 * more. Returns the ids removed.
 */
export async function capEndedSessions(dirs: SpoolDirs, max: number): Promise<string[]> {
  const all = await readSessions(dirs);
  const ended = [...all.values()]
    .filter((s): s is Session & { endedAt: number } => s.endedAt !== undefined)
    .sort((a, b) => b.endedAt - a.endedAt || (a.id < b.id ? -1 : 1));
  const removed: string[] = [];
  for (const s of ended.slice(max)) {
    const current = await readSession(dirs, s.id);
    if (current === undefined || current.endedAt === undefined) continue;
    await removeSession(dirs, s.id);
    removed.push(s.id);
  }
  return removed;
}

export async function removeSession(dirs: SpoolDirs, id: string): Promise<void> {
  try {
    await unlink(join(dirs.sessions, `${id}.json`));
  } catch {
    // already removed by another window: harmless
  }
}

function isSession(v: unknown): v is Session {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['id'] === 'string' &&
    typeof o['cwd'] === 'string' &&
    typeof o['project'] === 'string' &&
    typeof o['origin'] === 'string' &&
    o['origin'] in ORIGINS &&
    typeof o['status'] === 'string' &&
    o['status'] in STATUSES &&
    typeof o['toolCount'] === 'number' &&
    typeof o['lastEventAt'] === 'number'
  );
}

/**
 * Reads a single session by id, without listing all of `sessions/`. This is
 * the read path used to reduce an event: reread this session's state right
 * before reducing it, rather than holding it from a snapshot taken before a
 * sequence of `await`s (see `drain`).
 */
export async function readSession(dirs: SpoolDirs, id: string): Promise<Session | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dirs.sessions, `${id}.json`), 'utf8'));
    // Ignored on read just as on write: a file left by a version that was
    // still writing the flag heals itself, instead of waiting for a manual
    // repair. The invariant only holds if it is total — forbidding the
    // write repairs nothing of what is already written.
    return isSession(parsed) ? persisted(parsed) : undefined;
  } catch {
    return undefined;
  }
}

export async function readSessions(dirs: SpoolDirs): Promise<Map<string, Session>> {
  const out = new Map<string, Session>();
  let names: string[];
  try {
    names = await readdir(dirs.sessions);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(dirs.sessions, name), 'utf8'));
      if (isSession(parsed)) out.set(parsed.id, persisted(parsed));
    } catch {
      // unreadable file: ignored, it will be rewritten on the next event
    }
  }
  return out;
}
