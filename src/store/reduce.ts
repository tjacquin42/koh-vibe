import { originOf } from '../events/origin';
import { blankSession } from './blank';
import { HOOK_EVENTS, type EventName, type HookEvent, type Session, type SpoolEvent } from '../events/types';

/** Only a Claude Code hook event describes a session that exists: one of
 * our local events (`Ack`) reacts to a session already seen, and must
 * never spawn a new one out of thin air. */
function isHookEvent(event: EventName): event is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(event);
}

function create(ev: SpoolEvent): Session {
  return blankSession(ev.sessionId, ev.cwd, originOf(ev.entrypoint, ev.termProgram), ev.at);
}

/**
 * A pure function. Two VSCode windows replaying the same events end up at
 * the same state — that is what makes convergence possible without a lock.
 *
 * Returns `undefined` when the session must disappear — which now only
 * happens for an event with no prior session: a conversation that ends
 * stays, marked `endedAt`, until the user removes it.
 */
export function reduce(prev: Session | undefined, ev: SpoolEvent): Session | undefined {
  if (prev === undefined && (ev.event === 'SessionEnd' || !isHookEvent(ev.event))) return undefined;

  const base = prev ?? create(ev);

  // The spool does not order: an event can arrive after a more recent one.
  // We accept its cumulative effects, never its status transitions.
  const late = ev.at < base.lastEventAt;
  const next: Session = { ...base, lastEventAt: Math.max(base.lastEventAt, ev.at) };
  if (ev.transcriptPath !== undefined) next.transcriptPath = ev.transcriptPath;
  // A hook is the conversation living: whatever the user removed it for is
  // over, and so is its end — a resumed conversation starts with a hook.
  // `Ack` is our own event, and says nothing about the conversation. A LATE
  // hook says nothing either: it happened before the end it would undo, and
  // must not bring back a conversation another window has since seen end.
  if (isHookEvent(ev.event) && !late) {
    delete next.hidden;
    delete next.endedAt;
  }

  switch (ev.event) {
    case 'SessionEnd':
      // The tab closed, the process is gone: nothing is in flight any more,
      // and nothing is waiting. The row stays, greyed, in its folder — unless
      // the end is stale: a twin of this conversation in another editor has
      // spoken since, and it is that twin's process the row now stands for.
      if (!late) {
        next.status = 'idle';
        next.endedAt = ev.at;
        delete next.inFlightSince;
        delete next.currentAction;
        delete next.pendingPermission;
      }
      break;
    case 'SessionStart':
      next.startedAt = base.startedAt ?? ev.at;
      break;
    case 'UserPromptSubmit':
      if (!late) {
        next.status = 'running';
        delete next.pendingPermission;
      }
      break;
    case 'PreToolUse':
      if (!late) {
        next.status = 'running';
        next.inFlightSince = ev.at;
        // English fallback, not a localised one: this value is WRITTEN into the
        // shared state file, which every window of every language reads —
        // baking a translation into it would show one user's language to
        // another. English is the project's neutral default (CLAUDE.md).
        next.currentAction = { tool: ev.toolName ?? 'tool', target: ev.toolTarget };
        delete next.pendingPermission;
      }
      break;
    case 'PostToolUse':
      next.toolCount = base.toolCount + 1;
      if (!late) {
        delete next.inFlightSince;
        delete next.currentAction;
      }
      break;
    case 'PermissionRequest':
      if (!late) {
        next.status = 'waiting';
        next.pendingPermission = {
          // Same rule as `currentAction.tool` above: shared state, English fallback.
          tool: ev.toolName ?? 'tool',
          summary: ev.toolTarget ?? ev.message ?? '',
        };
      }
      break;
    case 'Notification':
      if (!late) next.status = 'waiting';
      break;
    case 'Stop':
      if (!late) {
        next.status = 'done_unseen';
        delete next.inFlightSince;
        delete next.currentAction;
      }
      break;
    case 'Ack':
      if (!late && base.status === 'done_unseen') next.status = 'idle';
      break;
    default: {
      // Exhaustiveness guard: a future member of `EventName` not handled
      // here becomes a compile error rather than a silent gap.
      const exhaustive: never = ev.event;
      throw new Error(`event the reducer does not handle: ${String(exhaustive)}`);
    }
  }

  return next;
}

export function reduceAll(events: readonly SpoolEvent[]): Map<string, Session> {
  const out = new Map<string, Session>();
  for (const ev of events) {
    const next = reduce(out.get(ev.sessionId), ev);
    if (next === undefined) out.delete(ev.sessionId);
    else out.set(ev.sessionId, next);
  }
  return out;
}
