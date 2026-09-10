import * as vscode from 'vscode';
import type { SessionProcess } from './classify';

/**
 * What terminating one row actually means: that process, and everything it
 * started, deepest first.
 *
 * The order is not cosmetic. Killing a parent on its own does not kill its
 * children — the system reparents them to pid 1, which takes them out of every
 * session's subtree and therefore out of this view for good. Killing the shell
 * of a `pnpm dev` without its `node vite` is precisely how the orphan dev
 * servers this feature exists to reveal are made in the first place.
 *
 * An unknown pid yields nothing rather than throwing: the table is a snapshot,
 * and the process may simply have exited between the render and the click.
 */
export function killTargets(procs: readonly SessionProcess[], pid: number): SessionProcess[] {
  const self = procs.find((p) => p.pid === pid);
  if (self === undefined) return [];
  const out: SessionProcess[] = [];
  const collect = (parent: number): void => {
    for (const child of procs.filter((p) => p.ppid === parent)) {
      collect(child.pid);
      out.push(child);
    }
  };
  collect(pid);
  // Children are appended as the walk unwinds, so they already come deepest
  // first; the process itself goes last.
  out.push(self);
  return out;
}

export interface KillPlan {
  targets: SessionProcess[];
  message: string;
  /** The second line of the dialog. Absent when there is nothing to warn about. */
  detail?: string;
  /** Whether the confirmation should be styled as the dangerous choice. */
  destructive: boolean;
}

/**
 * What to ask before killing, and how loudly.
 *
 * An MCP server is the one case that is not the user's to take back: Claude
 * Code started it for the conversation and will not start it again on its own,
 * so the session loses those tools until it is reloaded. That deserves a
 * warning of its own rather than the same sentence as a forgotten dev server.
 */
export function killPlan(procs: readonly SessionProcess[], proc: SessionProcess): KillPlan {
  const targets = killTargets(procs, proc.pid);
  const others = targets.length - 1;
  const message =
    others > 0
      ? vscode.l10n.t('Terminate "{0}" and the {1} processes it started?', proc.label, others)
      : vscode.l10n.t('Terminate "{0}"?', proc.label);
  const plan: KillPlan = { targets, message, destructive: proc.kind === 'mcp' };
  if (proc.kind === 'mcp') {
    plan.detail = vscode.l10n.t(
      'This is a server Claude Code started for this conversation. The session loses its tools until it is reloaded.',
    );
  }
  return plan;
}

/**
 * Sends `SIGTERM` to each target and returns how many were reached.
 *
 * `SIGTERM` and never `SIGKILL`: a dev server asked to stop closes its port
 * and its watchers, where a killed one can leave the port held. The user who
 * needs the harder signal has a terminal for it.
 *
 * A process that is already gone (`ESRCH`) is not a failure — it is the
 * ordinary race between a snapshot and a click, and the row was about to
 * disappear anyway.
 */
export function killAll(targets: readonly SessionProcess[], send: (pid: number) => void = terminate): number {
  let killed = 0;
  for (const target of targets) {
    try {
      send(target.pid);
      killed += 1;
    } catch {
      // Already gone, or not ours to signal. Neither is worth interrupting the
      // rest of the list for.
    }
  }
  return killed;
}

function terminate(pid: number): void {
  process.kill(pid, 'SIGTERM');
}
