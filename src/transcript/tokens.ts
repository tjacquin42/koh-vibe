import type { Session } from '../events/types';
import { readTranscript, type TranscriptStats } from './reader';

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
    } catch (err) {
      onFailure?.(s, err);
    }
  }
  return sessions;
}
