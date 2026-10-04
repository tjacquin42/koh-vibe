import { sep } from 'node:path';
import type { Session } from '../events/types';

/**
 * Case-insensitive comparison: macOS (HFS+/APFS by default) preserves case
 * without distinguishing it, so a hook's `cwd` captured with a different
 * case than the folder opened in the window is still the same project. The
 * separator keeps a neighbouring project with a shared prefix from being
 * claimed.
 */
export function claims(folders: readonly string[], cwd: string): boolean {
  const target = cwd.toLowerCase();
  return folders.some((f) => {
    const folder = f.toLowerCase();
    return target === folder || target.startsWith(folder.endsWith(sep) ? folder : folder + sep);
  });
}

/**
 * « Done unseen » sessions these workspace folders claim: exactly what the
 * spec (§5) acknowledges when the view becomes visible in a window — « the
 * window that claims it », never every session of every project. Pure
 * function, extracted for the same reason as `claims()`: to stay testable
 * without `vscode`.
 */
export function sessionsToAcknowledge(sessions: Iterable<Session>, folders: readonly string[]): Session[] {
  const out: Session[] = [];
  for (const s of sessions) {
    if (s.status === 'done_unseen' && claims(folders, s.cwd)) out.push(s);
  }
  return out;
}
