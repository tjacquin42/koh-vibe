/**
 * What the live conversations are running: one `ps` and Claude Code's
 * registry of running sessions. Nothing here signals anything — stopping a
 * process is an action (actions.ts), which finds its target again with
 * `locateProcess` at the moment of the click.
 *
 * Only what a conversation runs (15/11): the processes of no conversation —
 * servers left behind, which V1 looks for with an `lsof` — are not listed,
 * so they are neither scanned for nor found again.
 *
 * The subagent mark V1 puts on a process is not reproduced: it comes from the
 * hook events V1 drains from the spool, which this extension must not touch
 * while V1 owns it (step 5).
 */
import { readLiveSessions, type LiveSession } from '../../../src/claude/registry';
import type { SessionProcess } from '../../../src/process/classify';
import { snapshot, type ProcTable } from '../../../src/process/scan';
import { processesBySession } from '../../../src/process/sessions';
import type { ProcessView, ProcessesView } from '../shared/protocol';

export interface ProcessDeps {
  table(): Promise<ProcTable>;
  live(): Promise<ReadonlyMap<string, LiveSession>>;
}

export function systemProcessDeps(registryDir: string): ProcessDeps {
  return {
    table: () => snapshot(),
    live: () => readLiveSessions(registryDir),
  };
}

export function toProcessView(p: SessionProcess): ProcessView {
  return { pid: p.pid, label: p.label, kind: p.kind, elapsed: p.elapsed, rss: p.rss, depth: p.depth };
}

export async function scanProcesses(deps: ProcessDeps, now: number): Promise<ProcessesView> {
  const [table, live] = await Promise.all([deps.table(), deps.live()]);
  return {
    at: now,
    bySession: Object.fromEntries([...processesBySession(table, live)].map(([id, procs]) => [id, procs.map(toProcessView)])),
  };
}

export interface Located {
  proc: SessionProcess;
  /** The conversation's list it sits in, which says what dies with it. */
  among: SessionProcess[];
}

/**
 * The process `pid`, read again now rather than taken from the row: a row is
 * seconds old, and a pid freed in the meantime can be handed to an unrelated
 * process. Only a process this extension lists is found — one of a live
 * conversation's — never any pid at all.
 */
export async function locateProcess(deps: ProcessDeps, pid: number): Promise<Located | undefined> {
  const [table, live] = await Promise.all([deps.table(), deps.live()]);
  for (const among of processesBySession(table, live).values()) {
    const proc = among.find((p) => p.pid === pid);
    if (proc !== undefined) return { proc, among };
  }
  return undefined;
}
