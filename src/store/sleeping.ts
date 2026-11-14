import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidSessionId } from '../events/parse';

/**
 * A conversation put to sleep by hand stays in the list, greyed — filed in a
 * folder or not (14/11). Its end comes from a hook, in whichever window
 * drains the spool, so the wish is left where every window reads it: a marker
 * per conversation, taken by the drain when the end arrives.
 *
 * Without it, a conversation in no folder went to the archives on sleep, the
 * « persistent sessions » setting being off — the same as closing its tab.
 */
const MARKER_TTL_MS = 10 * 60 * 1000;

function markerOf(home: string, sessionId: string): string | undefined {
  return isValidSessionId(sessionId) ? join(home, 'sleeping', sessionId) : undefined;
}

/** Leaves the wish before the tab closes. */
export async function markSleeping(home: string, sessionId: string, now: number): Promise<void> {
  const file = markerOf(home, sessionId);
  if (file === undefined) return;
  await mkdir(join(home, 'sleeping'), { recursive: true });
  await writeFile(file, String(now), 'utf8');
}

/**
 * Whether the conversation was put to sleep — taken once: the marker goes.
 * One left for long (an end that never came) says nothing any more.
 */
export async function takeSleeping(home: string, sessionId: string, now: number): Promise<boolean> {
  const file = markerOf(home, sessionId);
  if (file === undefined) return false;
  try {
    const at = Number(await readFile(file, 'utf8'));
    await unlink(file);
    return Number.isFinite(at) && now - at <= MARKER_TTL_MS;
  } catch {
    return false;
  }
}
