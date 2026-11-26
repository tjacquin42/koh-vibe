import type { Session } from '../events/types';
import { readTranscript, type TranscriptStats } from './reader';

/**
 * A conversation the user stopped after its last hook rests (21/11). No hook
 * says so (see `TranscriptStats.interruptedAt`), so without this a question
 * closed with its × kept the row waiting, orange, until the next prompt.
 * Any hook after the interruption — the next prompt first — is newer and
 * wins: the state it set stands.
 */
export function settleInterrupted(s: Session, interruptedAt: number | undefined): void {
  if (interruptedAt === undefined || interruptedAt <= s.lastEventAt) return;
  if (s.endedAt !== undefined || (s.status !== 'waiting' && s.status !== 'running')) return;
  s.status = 'idle';
  delete s.pendingPermission;
  delete s.inFlightSince;
  delete s.currentAction;
}

/**
 * Attaches each session's transcript token counters to it.
 *
 * Isolated per session: `readTranscript` only guards against the missing-
 * file case (a failing open()). Everything else — permission denied, the
 * path having become a folder, exhausted descriptors, a volume unmounted
 * mid-read — still throws, and the only guarantee possible is that none of
 * these causes must deprive the *other* sessions of their counters, nor
 * make the caller disappear without having been able to return the
 * sessions that did work. A session whose read fails simply keeps its old
 * counters (or never had any); the next call will try again.
 */
export async function withTokens(
  sessions: Map<string, Session>,
  transcripts: Map<string, TranscriptStats>,
  onFailure?: (session: Session, err: unknown) => void,
): Promise<Map<string, Session>> {
  for (const s of sessions.values()) {
    if (s.transcriptPath === undefined) continue;
    try {
      const stats = await readTranscript(s.transcriptPath, transcripts.get(s.id));
      transcripts.set(s.id, stats);
      s.tokens = { input: stats.input, output: stats.output };
      if (s.branch === undefined && stats.branch !== undefined) s.branch = stats.branch;
      if (stats.title !== undefined) s.title = stats.title;
      settleInterrupted(s, stats.interruptedAt);
    } catch (err) {
      onFailure?.(s, err);
    }
  }
  return sessions;
}
