import { branchOf, originOf, projectOf } from '../events/origin';
import { HOOK_EVENTS, type EventName, type HookEvent, type Session, type SpoolEvent } from '../events/types';

/** Seul un événement de hook Claude Code décrit une session qui existe : un de
 * nos événements locaux (`Ack`) réagit à une session déjà vue, il ne doit
 * jamais en faire naître une nouvelle de toutes pièces. */
function isHookEvent(event: EventName): event is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(event);
}

function create(ev: SpoolEvent): Session {
  const session: Session = {
    id: ev.sessionId,
    cwd: ev.cwd,
    project: projectOf(ev.cwd),
    origin: originOf(ev.entrypoint, ev.termProgram),
    status: 'idle',
    toolCount: 0,
    lastEventAt: ev.at,
  };
  const branch = branchOf(ev.cwd);
  if (branch !== undefined) session.branch = branch;
  return session;
}

/**
 * Fonction pure. Deux fenêtres VSCode qui rejouent les mêmes événements
 * aboutissent au même état — c'est ce qui rend la convergence possible sans verrou.
 *
 * Retourne `undefined` quand la session doit disparaître — ce qui n'arrive
 * plus qu'à un événement sans session préalable : une conversation qui se
 * termine reste, marquée `endedAt`, jusqu'à ce que l'utilisateur la retire.
 */
export function reduce(prev: Session | undefined, ev: SpoolEvent): Session | undefined {
  if (prev === undefined && (ev.event === 'SessionEnd' || !isHookEvent(ev.event))) return undefined;

  const base = prev ?? create(ev);

  // Le spool n'ordonne pas : un événement peut arriver après un plus récent.
  // On accepte ses effets cumulatifs, jamais ses transitions de statut.
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
      // Garde d'exhaustivité : un futur membre d'`EventName` non traité ici
      // devient une erreur de compilation plutôt qu'un trou silencieux.
      const exhaustive: never = ev.event;
      throw new Error(`événement non géré par le réducteur : ${String(exhaustive)}`);
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
