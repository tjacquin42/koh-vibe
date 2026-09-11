import type { SpoolEvent } from '../events/types';
import { copyableCommand, type SessionProcess } from './classify';

/** The agent a process belongs to, as a row shows it. */
export interface AgentMark {
  id: string;
  /** The kind of agent Claude Code resolved, e.g. `general-purpose`. */
  type: string;
}

/**
 * How long a claim survives without ever being closed.
 *
 * A session that dies in the middle of a command sends no closing event, so
 * its claim would otherwise sit in the index for the life of the window and
 * put an agent's mark on an unrelated command that happens to match. Six hours
 * is far longer than any command anyone watches, and far shorter than a window
 * left open for a week.
 */
const CLAIM_TTL_MS = 6 * 60 * 60 * 1000;

/** The same cut the spool applies to a command it stores (events/parse.ts). */
const MAX_TARGET = 80;

/**
 * The text both sides compare on.
 *
 * There is no identifier tying a hook event to a process — only the command
 * itself — so the two representations of it have to be reduced to the same
 * string. The spool collapses every run of whitespace and cuts at eighty
 * characters before storing a command; this does the same to what the process
 * table reports, which spaces and wraps it differently.
 */
export function agentKey(command: string): string {
  const flat = command.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TARGET ? flat.slice(0, MAX_TARGET - 1) : flat;
}

interface Claim extends AgentMark {
  at: number;
}

/**
 * Which commands are running on behalf of an agent, right now.
 *
 * Claude Code says so itself: a tool call made by a subagent carries
 * `agent_id` and `agent_type` in its hook payload, under the parent
 * conversation's session id, and a call made by the conversation itself
 * carries neither. The information reaches the extension already — this is
 * where it stops being thrown away.
 *
 * Lives in memory, per window, and is never persisted: it describes what is
 * running at this instant, and a stale claim read back from disk would mark
 * the wrong process.
 */
export class AgentIndex {
  private readonly claims = new Map<string, Claim>();

  /**
   * Takes account of one drained event.
   *
   * Only `Bash` matters: it is the one tool that leaves a process behind for
   * the scan to find. An event without an agent is not merely ignored — it is
   * the main conversation's own work, and has no claim to record.
   */
  note(event: SpoolEvent): void {
    if (event.toolName !== 'Bash') return;
    const key = agentKey(event.toolTarget ?? '');
    if (key.length === 0) return;
    if (event.event === 'PostToolUse') {
      // Cleared whoever it belonged to: the command is over, and the next
      // identical one may well be the conversation's own.
      this.claims.delete(key);
      return;
    }
    if (event.event !== 'PreToolUse') return;
    const id = event.agentId;
    if (id === undefined) return;
    // Last claim wins. Two agents running the exact same command are
    // indistinguishable by construction — the command is the only link — and
    // the cost is the right icon on the wrong one of two identical rows.
    this.claims.set(key, { id, type: event.agentType ?? '', at: event.at });
  }

  markOf(command: string): AgentMark | undefined {
    const claim = this.claims.get(agentKey(command));
    return claim === undefined ? undefined : { id: claim.id, type: claim.type };
  }

  /** Drops the claims nothing ever closed. Called from the render loop. */
  prune(now: number): void {
    for (const [key, claim] of this.claims) {
      if (now - claim.at > CLAIM_TTL_MS) this.claims.delete(key);
    }
  }
}

/**
 * Attaches the agent behind each command to the processes it left running.
 *
 * The mark goes on the shell that ran the command AND on everything under it:
 * a server an agent started is the agent's doing as much as the shell above
 * it, and the server is the row a reader actually looks at.
 *
 * Returns the very map it was given when nothing matched. The view compares
 * what it renders to decide whether to redraw, and rebuilding an identical
 * structure on every tick would defeat that comparison before it is made.
 */
export function withAgents(
  processes: ReadonlyMap<string, SessionProcess[]>,
  index: AgentIndex,
): ReadonlyMap<string, SessionProcess[]> {
  const out = new Map<string, SessionProcess[]>();
  let marked = false;
  for (const [sessionId, procs] of processes) {
    const marks = new Map<number, AgentMark>();
    const next = procs.map((proc) => {
      // Inherited first: a child of a marked process belongs to the same agent,
      // whatever its own command says. The walk trusts the order
      // `descendantsOf` returns — a parent always precedes its children.
      const mark = marks.get(proc.ppid) ?? index.markOf(copyableCommand(proc.command));
      if (mark === undefined) return proc;
      marks.set(proc.pid, mark);
      marked = true;
      return { ...proc, agent: mark };
    });
    out.set(sessionId, next);
  }
  return marked ? out : processes;
}
