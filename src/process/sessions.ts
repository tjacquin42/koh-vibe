import type { LiveSession } from '../claude/registry';
import { classify, type SessionProcess } from './classify';
import { descendantsOf, type ProcRow } from './scan';

/**
 * What each live session is running right now, keyed by session id.
 *
 * The registry is what makes this possible at all: it is the only place that
 * ties a conversation to a pid. Everything a session starts — MCP servers,
 * every run of the Bash tool and whatever those leave behind — stays in that
 * pid's descendants, so one `ps` and one walk per session is the whole
 * mechanism. No hook, no cooperation from Claude Code, nothing to install.
 *
 * A session that started nothing is absent rather than mapped to an empty
 * list: absence already means "nothing to show", and a caller that has to
 * test both is a caller that will one day test only one.
 *
 * The blind spot, and it is worth knowing: a process that detaches itself —
 * `nohup`, a `launchd` job, anything that reparents to pid 1 — leaves the
 * subtree and cannot be attributed to the session that started it. Nothing
 * short of process accounting would catch those, and they are rare enough in
 * a development session that the trade is worth it.
 */
export function processesBySession(
  rows: readonly ProcRow[],
  live: ReadonlyMap<string, LiveSession>,
): Map<string, SessionProcess[]> {
  const out = new Map<string, SessionProcess[]>();
  if (rows.length === 0) return out;
  for (const [sessionId, entry] of live) {
    const found = classify(descendantsOf(rows, entry.pid));
    if (found.length > 0) out.set(sessionId, found);
  }
  return out;
}
