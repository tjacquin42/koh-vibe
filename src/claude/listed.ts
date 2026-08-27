import { existsSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '../lib/json';
import { isValidSessionId } from '../events/parse';
import { transcriptPathFor } from './rescan';

/**
 * The key under which the editor keeps the Claude Code extension's global
 * state — where the ids the user hid from its session list live.
 */
export const CLAUDE_STATE_KEY = 'Anthropic.claude-code';

/** The ids hidden from Claude Code's own session list, out of its global state. */
export function parseHiddenSessionIds(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (raw === undefined) return out;
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isRecord(root)) return out;
  const ids = root['hiddenSessionIds'];
  if (!Array.isArray(ids)) return out;
  for (const id of ids) if (typeof id === 'string' && isValidSessionId(id)) out.add(id);
  return out;
}

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
 * Observed on the extension (2.1.247): a new panel asks the extension host for
 * the session list of the window's folder — the transcripts under
 * `~/.claude/projects/<slug(folder)>/`, minus the ids the user hid — and when
 * the id is not in it, the webview creates a fresh session. A conversation
 * run from a worktree, or filed under another project, is therefore never
 * reopened by that command from here: it needs a terminal, where `claude
 * --resume` finds a conversation by its id across every project.
 */
export function sessionListedIn(
  claudeHome: string,
  folder: string,
  sessionId: string,
  hidden: ReadonlySet<string>,
  exists: (path: string) => boolean = existsSync,
): boolean {
  if (hidden.has(sessionId)) return false;
  return exists(transcriptPathFor(claudeHome, folder, sessionId));
}
