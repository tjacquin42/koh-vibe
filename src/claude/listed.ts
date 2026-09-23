import { existsSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isValidSessionId } from '../events/parse';
import { transcriptPathFor } from './rescan';

/**
 * The folder Claude Code lists sessions for in a window: its first workspace
 * folder — the home directory without one — resolved and normalised exactly
 * the way its extension does before it derives the project directory.
 */
export function listingFolder(folders: readonly string[], home: string = homedir()): string {
  const first = folders[0] ?? home;
  let real = first;
  try {
    real = realpathSync(first);
  } catch {
    // Keep the path as given: a folder that cannot be resolved lists nothing anyway.
  }
  return real.normalize('NFC');
}

/**
 * The transcript of a conversation, wherever Claude Code filed it — under the
 * project it was launched from, or wherever it was moved since. `undefined`
 * when none exists: a session that never got a message writes no transcript,
 * and there is nothing to resume in it. Never throws.
 */
export async function findTranscript(claudeHome: string, sessionId: string): Promise<string | undefined> {
  if (!isValidSessionId(sessionId)) return undefined;
  const projects = join(claudeHome, 'projects');
  let dirs: string[];
  try {
    dirs = await readdir(projects);
  } catch {
    return undefined;
  }
  for (const dir of dirs) {
    const path = join(projects, dir, `${sessionId}.jsonl`);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/**
 * Whether `claude-vscode.editor.open(id)` would resume `id` in a window on
 * `folder` — rather than start a blank conversation.
 *
 * What decides is the session list of the WINDOW's folder: the transcripts
 * under `~/.claude/projects/<slug(folder)>/`, and nothing else
 * (`buildSessionList`, extension 2.1.270, reads `dir: cwd` without
 * worktrees). When the id is not in it, the webview creates a fresh session.
 * A conversation run from a worktree, or filed under another project, is
 * therefore never reopened by that command from here: it needs a terminal,
 * where `claude --resume` finds a conversation by its id across every project.
 *
 * An ARCHIVED conversation is a different matter, and this used to get it
 * wrong. Claude Code archives a session on its own after two weeks without
 * activity (`claudeCode.archiveInactiveSessions`, 14 days by default) and
 * files its id under `hiddenSessionIds`; but `buildSessionList` never drops
 * it — it marks it `archived: true` and hands it over like the others. Reading
 * that archive as an absence sent every conversation older than a fortnight to
 * a terminal, when its tab was there for the asking.
 */
export function sessionListedIn(
  claudeHome: string,
  folder: string,
  sessionId: string,
  exists: (path: string) => boolean = existsSync,
): boolean {
  return exists(transcriptPathFor(claudeHome, folder, sessionId));
}
