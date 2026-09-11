import type { ProcNode } from './scan';
import type { AgentMark } from './agents';

/**
 * What a process is, from the session's point of view.
 *
 * `mcp` is a server the session keeps for its whole life, `shell` one run of
 * the Bash tool, `work` whatever that run started. The three do not deserve
 * the same attention — an MCP server that has been up for two hours is the
 * normal state of things, a `vite` still up an hour after its command
 * returned is the one worth seeing.
 */
export type ProcKind = 'mcp' | 'shell' | 'work';

/**
 * The marker of a shell the Bash tool started. Claude Code sources a snapshot
 * of the user's shell into every one of them, and nothing else on the machine
 * does — which makes this string a far better test than the shell's name,
 * shared with every terminal the user opened themselves.
 */
const TOOL_SHELL = '/.claude/shell-snapshots/';

/** How much of a command line fits on a row before it stops being readable. */
const MAX_LABEL = 80;

export function kindOf(proc: { command: string; depth: number }): ProcKind {
  if (proc.command.includes(TOOL_SHELL)) return 'shell';
  // A direct child that is not a tool shell is a server Claude Code started
  // and holds: today the MCP ones. Recognising them by position rather than by
  // a name containing "mcp" is what keeps a server named after its vendor —
  // `Spline`, `uv` — from being filed as work the user started.
  return proc.depth === 0 ? 'mcp' : 'work';
}

/** One process of a session, as the dashboard shows it. */
export interface SessionProcess extends ProcNode {
  kind: ProcKind;
  /** The command line, made readable — see `displayCommand`. */
  label: string;
  /**
   * The subagent that ran this command, when one did. Attached after the fact
   * by `withAgents`, from what the hooks said — nothing in the process table
   * distinguishes an agent's command from the conversation's own.
   */
  agent?: AgentMark;
}

/**
 * Puts a kind and a label on every process of a subtree.
 *
 * The kind is not read off each line on its own: what an MCP server starts is
 * part of that server, not work the session did. `uv` launching the real
 * `alpaca-mcp-server` under it is the ordinary case, and read line by line the
 * second process passes for something the user asked for.
 *
 * The walk trusts the order `descendantsOf` returns — a parent always comes
 * before its children — so one pass is enough, with no second index to keep.
 */
export function classify(nodes: readonly ProcNode[]): SessionProcess[] {
  const kinds = new Map<number, ProcKind>();
  return nodes.map((node) => {
    const inherited = kinds.get(node.ppid);
    const kind = inherited === 'mcp' ? 'mcp' : kindOf(node);
    kinds.set(node.pid, kind);
    return { ...node, kind, label: displayCommand(node.command) };
  });
}

/**
 * The same, for a subtree that hangs off no session at all.
 *
 * `kindOf` reads depth 0 as "started by a conversation", which is what makes an
 * MCP server recognisable there. Applied to a process the system has adopted,
 * that rule says the opposite of the truth: nothing about an orphan is anyone's
 * MCP server, and the only distinction left worth drawing is the shell a
 * command ran in from the command itself.
 */
export function classifyDetached(nodes: readonly ProcNode[]): SessionProcess[] {
  return nodes.map((node) => ({
    ...node,
    kind: node.command.includes(TOOL_SHELL) ? ('shell' as const) : ('work' as const),
    label: displayCommand(node.command),
  }));
}

/**
 * What the command actually was, short enough to read on a tree row.
 *
 * A tool shell is unreadable as reported — a `source`, a couple of `setopt`,
 * the real command buried in an `eval`, and a `pwd` written to a temporary
 * file. What the user wants to see is the command they would have typed, so
 * that is what is pulled out.
 */
export function displayCommand(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length === 0) return '?';
  // Flattened and cut, because a tree row is one line and eighty columns.
  const shown = trimmed.includes(TOOL_SHELL) ? insideEval(trimmed) : basename(trimmed);
  return shorten(shown.replace(/\s*\n\s*/g, ' '));
}

/**
 * The same command, for the clipboard rather than for a row: whole, and with
 * its newlines.
 *
 * Neither of the two things the label does to fit is acceptable here. Cutting
 * at eighty characters gives a command that does not run, and flattening a
 * multi-line one changes what it means — `echo a\necho b` pasted back as
 * `echo a echo b` is a different command entirely.
 *
 * The plumbing of a tool shell is still stripped: nobody wants to paste a
 * `source` of a shell snapshot and a `pwd` into a temporary file. What is
 * copied is the command the user would have typed, which is also what the row
 * showed them.
 */
export function copyableCommand(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length === 0) return '';
  return trimmed.includes(TOOL_SHELL) ? insideEval(trimmed) : trimmed;
}

/**
 * The command a tool shell was given, read between `eval '` and the `'` that
 * closes it. Falls back to naming the shell rather than showing its whole
 * line: a shape we no longer recognise must degrade into something short and
 * true, not into eighty characters of plumbing.
 */
function insideEval(command: string): string {
  const start = command.indexOf("eval '");
  if (start === -1) return basename(command).split(' ')[0] ?? '?';
  const body = command.slice(start + "eval '".length);
  const end = body.lastIndexOf("' <");
  const inner = (end === -1 ? body : body.slice(0, end)).trim();
  // Returned as it stands, newlines included: `displayCommand` flattens it for
  // its row, and `copyableCommand` must not — see there.
  return inner.length === 0 ? 'zsh' : inner;
}

/** Drops the directories of the leading binary, keeps every argument. */
function basename(command: string): string {
  const space = command.indexOf(' ');
  const head = space === -1 ? command : command.slice(0, space);
  const rest = space === -1 ? '' : command.slice(space);
  return `${head.slice(head.lastIndexOf('/') + 1)}${rest}`;
}

function shorten(label: string): string {
  return label.length <= MAX_LABEL ? label : `${label.slice(0, MAX_LABEL - 1)}…`;
}
