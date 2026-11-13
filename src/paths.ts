import { join } from 'node:path';

export interface SpoolDirs {
  events: string;
  sessions: string;
  requests: string;
  rejected: string;
  backups: string;
}

/** The variable when it is set and not empty, else `<HOME>/<suffix>` — the one rule of the three roots below. */
function rootOf(env: NodeJS.ProcessEnv, variable: string, suffix: string): string {
  const override = env[variable];
  if (override !== undefined && override.length > 0) return override;
  return join(env['HOME'] ?? '', suffix);
}

/** Root of koh-vibe's state. `KOH_VIBE_HOME` allows isolating it in tests. */
export function kohVibeHome(env: NodeJS.ProcessEnv = process.env): string {
  return rootOf(env, 'KOH_VIBE_HOME', '.koh-vibe');
}

/**
 * The old location of the state, before the extension became Koh-Vibe.
 *
 * Follows the SAME isolation setting as `kohVibeHome`: without this, a test
 * that redirects the root would still see the machine's real `~/.koh-claude`,
 * and the migration would run against the user's real sessions.
 */
export function legacyHome(env: NodeJS.ProcessEnv = process.env): string {
  return rootOf(env, 'KOH_VIBE_LEGACY_HOME', '.koh-claude');
}

export function spoolDirs(home: string): SpoolDirs {
  const events = join(home, 'events');
  return {
    events,
    sessions: join(home, 'sessions'),
    requests: join(home, 'requests'),
    rejected: join(events, 'rejected'),
    backups: join(home, 'backups'),
  };
}

/**
 * Latest snapshot of the statusline, dropped by the bridge. A single file
 * overwritten in place, never a spool: unlike hook events, only the most
 * recent value makes sense — a history of stale percentages would teach
 * nothing and would grow without end.
 */
export function statusFile(home: string): string {
  return join(home, 'status.json');
}

/**
 * The latest reading obtained from Anthropic, cached.
 *
 * Shared between windows and editors, like the classification into folders:
 * without this, every window would query the API on its own every few
 * minutes, to display exactly the same thing.
 */
export function usageFile(home: string): string {
  return join(home, 'usage.json');
}

/**
 * Sound settings, shared between editors.
 *
 * Same reason as the classification into folders: the same machine must not
 * announce two different chimes depending on which window is looking at it.
 */
export function settingsFile(home: string): string {
  return join(home, 'settings.json');
}

/**
 * A folder's rules: what bin/koh-vibe-rules adds to the context of the
 * conversations filed in it. Under the folder's id, not its name — a rename
 * keeps them.
 */
export function folderRulesFile(home: string, groupId: string): string {
  return join(home, 'rules', `${groupId}.md`);
}

/** Shared file for the classification into folders, at the root of koh-vibe's state. */
export function groupsFile(home: string): string {
  return join(home, 'groups.json');
}

/**
 * The recently closed conversations, shared between windows.
 *
 * Same reason as the folder layout: what one window has just closed must be
 * offered for reopening in all the others.
 */
export function closedFile(home: string): string {
  return join(home, 'closed.json');
}

/**
 * Claude Code's own configuration root — where it keeps `settings.json`, the
 * transcripts (`projects/`) and the registry of running sessions
 * (`sessions/`). Follows the variable Claude Code itself honours, so that a
 * relocated configuration is read where Claude Code writes it.
 */
export function claudeHome(env: NodeJS.ProcessEnv = process.env): string {
  return rootOf(env, 'CLAUDE_CONFIG_DIR', '.claude');
}

/**
 * The registry of running Claude Code processes: one `<pid>.json` per
 * interactive session, written by Claude Code 2.1.x and removed on a clean
 * exit. Read by `claude/registry.ts`; koh-vibe never writes here.
 */
export function claudeSessionsDir(home: string): string {
  return join(home, 'sessions');
}

/**
 * The routines last read from claude.ai, cached — shared between windows like
 * the usage reading, for the same reason.
 */
export function routinesFile(home: string): string {
  return join(home, 'routines.json');
}

/** The artifacts last read from claude.ai, cached — same reason. */
export function artifactsFile(home: string): string {
  return join(home, 'artifacts.json');
}

/**
 * Claude Code's global configuration — the account it is signed in with,
 * among much else. Beside the configuration root by default (`~/.claude.json`,
 * not inside `~/.claude/`), inside the root once CLAUDE_CONFIG_DIR relocates
 * it: that is where Claude Code itself writes it then.
 */
export function claudeConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['CLAUDE_CONFIG_DIR'];
  if (override !== undefined && override.length > 0) return join(override, '.claude.json');
  return join(env['HOME'] ?? '', '.claude.json');
}

/**
 * Which project each artifact is filed under. claude.ai has no folders for
 * artifacts, so the filing lives here — shared between windows like the
 * session folders, and for the same reason.
 */
export function artifactProjectsFile(home: string): string {
  return join(home, 'artifact-projects.json');
}
