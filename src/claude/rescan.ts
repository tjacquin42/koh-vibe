import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpoolDirs } from '../paths';
import type { Session } from '../events/types';
import { branchOf, originOf, projectOf } from '../events/origin';
import { createSession, readSession, writeSession } from '../spool/persist';
import type { LiveSession } from './registry';

/**
 * Where Claude Code keeps the transcript of a session: under `projects/`, in a
 * folder named after the working directory with every character outside
 * `[A-Za-z0-9]` turned into a dash — dots and underscores included, as
 * observed on real folders (`/a/.b_c` is `-a--b-c`). Only ever a guess to be
 * checked against the disk: the hooks carry the real path, this is what we
 * have until the next one arrives.
 */
export function transcriptPathFor(claudeHome: string, cwd: string, sessionId: string): string {
  return join(claudeHome, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Brings back into the spool every conversation whose process is running but
 * whose state file is gone — ended by a window reload before its tab was
 * resumed, or removed by hand — and returns the ids it added, sorted.
 *
 * Adds, and revives: a session the spool already knows is left exactly as it
 * is (its status and counters come from real hooks) — unless it is marked
 * ended while a process still carries it. That is the same conversation open
 * in two editors, one of which quit: its `SessionEnd` ended the row, its twin
 * is alive, and the row comes back to life. Nothing is ever removed here:
 * only the user takes a session off the list.
 *
 * What a recreated session carries is what the registry and the path say:
 * `idle`, no tool count, dated from the process start — nothing has happened
 * since, and the age shown must stay true — with the origin read off the
 * entrypoint like the hooks do, and the transcript only when the file is
 * really there. Its folder assignment, if the file still holds one, applies
 * by id: it comes back where it was filed.
 *
 * `removed` is the one thing that outranks the registry: the ids the user
 * took off the list in this window. A row taken off leaves no state file
 * behind — which is precisely the state this function exists to repair — so
 * without it the trash and the rescan pull against each other. And they do
 * meet: closing the tab is itself what changes this window's Claude tab
 * count, which starts a rescan on the spot, while the process behind the
 * closed tab is still registered and still alive.
 */
export async function rescanLiveSessions(
  dirs: SpoolDirs,
  live: ReadonlyMap<string, LiveSession>,
  now: number,
  claudeHome: string,
  removed: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const added: string[] = [];
  const entries = [...live.values()].sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  for (const entry of entries) {
    // Read here, at the last moment, and never captured before the loop:
    // `remove` marks the id BEFORE it deletes the file, so a rescan already
    // under way when the user clicks still sees a removal it would otherwise
    // race — the very race that made this bug intermittent.
    if (removed.has(entry.sessionId)) continue;
    const known = await readSession(dirs, entry.sessionId);
    if (known !== undefined) {
      if (known.endedAt === undefined) continue;
      const { endedAt: _over, ...revived } = known;
      await writeSession(dirs, revived);
      added.push(entry.sessionId);
      continue;
    }
    const session: Session = {
      id: entry.sessionId,
      cwd: entry.cwd,
      project: projectOf(entry.cwd),
      origin: originOf(entry.entrypoint, ''),
      status: 'idle',
      toolCount: 0,
      lastEventAt: entry.startedAt ?? now,
    };
    const branch = branchOf(entry.cwd);
    if (branch !== undefined) session.branch = branch;
    if (entry.startedAt !== undefined) session.startedAt = entry.startedAt;
    const transcript = transcriptPathFor(claudeHome, entry.cwd, entry.sessionId);
    if (await exists(transcript)) session.transcriptPath = transcript;
    if (await createSession(dirs, session)) added.push(entry.sessionId);
  }
  return added;
}
