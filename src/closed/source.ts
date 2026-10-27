import type { Session } from '../events/types';
import type { TranscriptStats } from '../transcript/reader';
import type { ClosedSource } from './model';

/** `readTranscript`'s shape: from `from` onwards, or from the start without it. */
export type ReadTranscript = (path: string, from?: TranscriptStats) => Promise<TranscriptStats>;

/**
 * What an ended conversation is archived under.
 *
 * `s` is read off disk, where the title — and, outside a worktree, the branch —
 * is never written: both live in the render's transcript cache, `cached`. That
 * cache is empty right after the window loads, which is exactly when the
 * `SessionEnd`s of the reload that killed the previous processes are drained:
 * five conversations ended by one reload were once archived with no name, and
 * showed as their bare folder. So the transcript is read here — on from where
 * the cache stopped, or from the start when it never began. A read that fails
 * archives the conversation nameless rather than not at all.
 *
 * The stats read here are not put back in the cache: the next render reads the
 * same lines again from the same offset, and counts them once.
 */
export async function closedSource(
  s: Session,
  cached: TranscriptStats | undefined,
  read: ReadTranscript,
): Promise<ClosedSource> {
  let stats = cached;
  if (s.title === undefined && s.transcriptPath !== undefined) {
    try {
      stats = await read(s.transcriptPath, cached);
    } catch {
      // Nameless rather than lost: the archive must not fail on its title.
    }
  }
  return { ...s, title: s.title ?? stats?.title, branch: s.branch ?? stats?.branch };
}
