import type { SpoolDirs } from '../paths';
import { readSessions } from '../spool/persist';
import { pruneAssignments } from './model';
import { readGroups, updateGroups } from './store';

async function liveSessionIds(dirs: SpoolDirs): Promise<Set<string>> {
  return new Set((await readSessions(dirs)).keys());
}

/**
 * Removes from the folder layout the assignments of sessions that have just
 * left the list — closed, or removed by hand. Extracted from its call site
 * (extension.ts) to stay testable at the composition boundary, not only at the
 * pure primitive (`pruneAssignments`) it calls — same precedent as
 * `acknowledgeVisibleSessions` (src/focus/acknowledge.ts).
 *
 * Two guards against a needless write:
 * 1. `removed` empty: no read, no write.
 * 2. none of the removed sessions was filed anywhere: `pruneAssignments` then
 *    returns the very same object (identity guarantee, see model.ts), which is
 *    what tells us not to call `updateGroups` — it would otherwise write
 *    unconditionally. That read is only an optimisation: it decides whether
 *    the call is worth making, never what gets removed — see the rule below.
 *
 * General rule: nothing that serves to decide may be read before the state it
 * decides on. `live` — the sessions still on disk — is therefore recomputed
 * INSIDE the transformation handed to `updateGroups`, at the same moment as
 * the state `s` it receives, never before. A first version captured `live`
 * once at the top and reused it: `updateGroups` re-reads the state inside, so
 * its `before` could already hold a brand-new assignment to a session that
 * appeared meanwhile — the frozen `live` ignored it, `pruneAssignments` took
 * it out, and `mergeAssignments` read that as a deliberate removal. A living
 * session lost its folder in silence. Third occurrence of that family of
 * defect in this project, always at a composition boundary: a value read
 * early deciding the fate of a value read late.
 */
export async function pruneAssignmentsOf(
  dirs: SpoolDirs,
  file: string,
  removed: readonly string[],
): Promise<void> {
  if (removed.length === 0) return;

  const before = await readGroups(file);
  if (pruneAssignments(before, await liveSessionIds(dirs)) === before) return;

  await updateGroups(file, async (s) => pruneAssignments(s, await liveSessionIds(dirs)));
}
