/**
 * What the live conversations are running — READ ONLY, like the rest of the
 * snapshot: one `ps`, Claude Code's registry of running sessions, and `lsof`
 * for the orphans only when asked. Nothing here signals or writes anything;
 * stopping a process is an action, and actions come at step 4.
 *
 * The subagent mark V1 puts on a process is not reproduced: it comes from the
 * hook events V1 drains from the spool, which this extension must not touch
 * while V1 owns it (step 5).
 */
import { readLiveSessions, type LiveSession } from '../../../src/claude/registry';
import type { SessionProcess } from '../../../src/process/classify';
import { findOrphans, reattachDetached, type Orphan } from '../../../src/process/orphans';
import { snapshot, type ProcTable } from '../../../src/process/scan';
import { processesBySession } from '../../../src/process/sessions';
import type { OrphanView, ProcessView, ProcessesView } from '../shared/protocol';

export interface ProcessDeps {
  table(): Promise<ProcTable>;
  live(): Promise<ReadonlyMap<string, LiveSession>>;
  orphans(table: ProcTable, roots: readonly string[]): Promise<Orphan[]>;
}

export function systemProcessDeps(registryDir: string): ProcessDeps {
  return {
    table: () => snapshot(),
    live: () => readLiveSessions(registryDir),
    orphans: (table, roots) => findOrphans(table, roots),
  };
}

export function toProcessView(p: SessionProcess): ProcessView {
  return { pid: p.pid, label: p.label, kind: p.kind, elapsed: p.elapsed, rss: p.rss, depth: p.depth };
}

/**
 * @param roots where a lost process has to be working to be claimed: the
 *   editor's folders and every listed conversation's directory, as in V1.
 * @param withOrphans false skips the `lsof`; the result then has no `orphans`.
 */
export async function scanProcesses(
  deps: ProcessDeps,
  roots: readonly string[],
  withOrphans: boolean,
  now: number,
): Promise<ProcessesView> {
  const [table, live] = await Promise.all([deps.table(), deps.live()]);
  let bySession: ReadonlyMap<string, SessionProcess[]> = processesBySession(table, live);
  let adrift: Orphan[] | undefined;
  if (withOrphans) {
    const found = await deps.orphans(table, roots);
    // A server a running conversation detached goes back under it; the rest
    // belongs to nobody, which is what the « No session » list is for.
    const claimed = reattachDetached(bySession, found, (id) => live.has(id));
    bySession = claimed.processes;
    adrift = claimed.adrift;
  }
  const view: ProcessesView = {
    at: now,
    bySession: Object.fromEntries([...bySession].map(([id, procs]) => [id, procs.map(toProcessView)])),
  };
  if (adrift !== undefined) {
    view.orphans = adrift.map((o): OrphanView => ({ cwd: o.cwd, tree: o.tree.map(toProcessView) }));
  }
  return view;
}
