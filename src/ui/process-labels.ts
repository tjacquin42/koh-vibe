import * as vscode from 'vscode';
import type { ProcKind, SessionProcess } from '../process/classify';
import { formatAge, formatAgeCoarse } from './labels';

/**
 * The glyph of each kind of process.
 *
 * Never `folder` nor `file`: VSCode hands those two to the file-icon theme
 * instead of drawing the codicon, and a theme set to "None" then draws
 * nothing at all — the trap the folder rows ran into, documented on
 * `GROUP_GLYPH`.
 */
export const PROCESS_GLYPH: Record<ProcKind, string> = {
  mcp: 'plug',
  shell: 'terminal',
  work: 'gear',
};

/**
 * What the session started itself, as opposed to what those started in turn.
 *
 * MCP servers are left out: they belong to the Processes view, where they are
 * shown once for the whole machine. Under a session they were three identical
 * rows repeated in every conversation, which is what pushed the work — the one
 * thing that differs from one session to the next — out of sight.
 */
export function rootsOf(procs: readonly SessionProcess[]): SessionProcess[] {
  return procs.filter((p) => p.depth === 0 && p.kind !== 'mcp');
}

/** The MCP servers a session holds, and what those started in turn. */
export function mcpOf(procs: readonly SessionProcess[]): SessionProcess[] {
  return procs.filter((p) => p.kind === 'mcp');
}

export function childrenOf(procs: readonly SessionProcess[], pid: number): SessionProcess[] {
  return procs.filter((p) => p.ppid === pid);
}

/**
 * How many processes to announce on the session's own row.
 *
 * MCP servers are deliberately left out. They start with the conversation and
 * die with it, so counting them would print the same number on every session
 * for its whole life — a badge that never moves is one the eye stops reading,
 * and it would bury the one case worth seeing: a server still up long after
 * the command that started it returned.
 */
export function processCount(procs: readonly SessionProcess[]): number {
  return procs.filter((p) => p.kind !== 'mcp').length;
}

/**
 * The right of the row: how long it has been up, coarsely.
 *
 * Coarse for the reason the session rows are (see `formatAgeCoarse`): this
 * text takes part in deciding whether the tree is redrawn, and a duration
 * ticking every second would rebuild the whole view twice a second and snatch
 * the tooltip from under the pointer.
 */
export function processDescription(proc: SessionProcess): string {
  const age = formatAgeCoarse(proc.elapsed * 1000);
  // Only the servers are named. A shell and its work are what the user just
  // asked for and recognise on sight; an MCP server is neither, and nothing
  // else on the row would say so.
  return proc.kind === 'mcp' ? `${vscode.l10n.t('MCP')} · ${age}` : age;
}

export function processTooltip(proc: SessionProcess): string {
  return [
    proc.command,
    `${KIND_LABEL[proc.kind]()} · ${vscode.l10n.t('pid {0}', proc.pid)} · ${formatAge(proc.elapsed * 1000)}`,
    vscode.l10n.t('{0} MB of memory', Math.round(proc.rss / 1024)),
  ].join('\n');
}

// The English literal IS the key of the translation bundle, so each one has to
// be specific enough that no other string in the extension ever wants it: a
// bare "command" would be claimed by the first unrelated caller to need the
// word, and both would then move together.
const KIND_LABEL: Record<ProcKind, () => string> = {
  mcp: () => vscode.l10n.t('MCP server'),
  shell: () => vscode.l10n.t('command run by the session'),
  work: () => vscode.l10n.t('started by that command'),
};
