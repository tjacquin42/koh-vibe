import type { SpoolDirs } from '../paths';
import type { Session } from '../events/types';
import { readSessions } from '../spool/persist';
import { appendLocalEvent } from '../spool/watcher';
import { sessionsToAcknowledge } from './claims';

/**
 * Acknowledges (spec §5) the « done unseen » sessions these workspace
 * folders claim — the complete action triggered when the view becomes
 * visible in a window. Extracted from `onVisible` (extension.ts) to stay
 * testable at the composition boundary, not only at the level of the pure
 * primitive (`sessionsToAcknowledge`) it calls: a reviewer proved by
 * mutation that acknowledging directly in `extension.ts` without going
 * through this primitive compiled and left every test green as long as
 * only the primitive, never the call site, was covered.
 */
export async function acknowledgeVisibleSessions(dirs: SpoolDirs, folders: readonly string[]): Promise<void> {
  const sessions = await readSessions(dirs);
  for (const s of sessionsToAcknowledge(sessions.values(), folders)) {
    await appendLocalEvent(dirs, { event: 'Ack', sessionId: s.id, cwd: s.cwd });
  }
}

/**
 * Acknowledges a session on click (spec §5: « click on the session »),
 * unconditionally — independent of `claims()`, which only governs the
 * passive acknowledgement of `acknowledgeVisibleSessions` above. Extracted
 * for the same reason: the click (kohVibe.focusSession) is the second place
 * where I6 was lost, and was covered by no test before this extraction. An
 * `Ack` on an unknown or already purged session does not recreate it (I2,
 * `reduce()` ignores an `Ack` with no prior session): no ordering check is
 * needed here.
 */
export async function acknowledgeClickedSession(
  dirs: SpoolDirs,
  s: Pick<Session, 'id' | 'cwd'>,
): Promise<void> {
  await appendLocalEvent(dirs, { event: 'Ack', sessionId: s.id, cwd: s.cwd });
}
