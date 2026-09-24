import type { Origin, Session } from '../events/types';
import { branchOf, projectOf } from '../events/origin';

/**
 * A conversation as it starts: idle, no tool yet, placed by its working
 * directory. The branch is set only when the directory names one — an absent
 * key, never `undefined`, since this object is written to disk as it is.
 *
 * Three readers used to assemble this by hand — the reducer for a first hook,
 * the rescan for a registry entry, the dormant tabs for a restored panel —
 * and a field added to the skeleton needed three synchronised edits.
 */
export function blankSession(id: string, cwd: string, origin: Origin, lastEventAt: number): Session {
  const session: Session = { id, cwd, project: projectOf(cwd), origin, status: 'idle', toolCount: 0, lastEventAt };
  const branch = branchOf(cwd);
  if (branch !== undefined) session.branch = branch;
  return session;
}
