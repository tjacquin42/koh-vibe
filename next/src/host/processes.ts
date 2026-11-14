/**
 * What the live conversations are running: one `ps`, Claude Code's registry
 * of running sessions, and `lsof` for the orphans only when asked. Nothing
 * here signals anything — stopping a process is an action (actions.ts), which
 * finds its target again with `locateProcess` at the moment of the click.
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

export interface Located {
  proc: SessionProcess;
  /** The list it sits in — a conversation's, or an orphan's tree — which says what dies with it. */
  among: SessionProcess[];
}

/**
 * The process `pid`, read again now rather than taken from the row: a row is
 * seconds old, and a pid freed in the meantime can be handed to an unrelated
 * process. Only a process this extension would list is found — one of a live
 * conversation's, or one of the orphans under `roots` — never any pid at all.
 */
export async function locateProcess(deps: ProcessDeps, roots: readonly string[], pid: number): Promise<Located | undefined> {
  const [table, live] = await Promise.all([deps.table(), deps.live()]);
  for (const among of processesBySession(table, live).values()) {
    const proc = among.find((p) => p.pid === pid);
    if (proc !== undefined) return { proc, among };
  }
  for (const o of await deps.orphans(table, roots)) {
    const proc = o.tree.find((p) => p.pid === pid);
    if (proc !== undefined) return { proc, among: o.tree };
  }
  return undefined;
}
