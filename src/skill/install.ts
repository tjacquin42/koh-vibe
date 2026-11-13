import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { isRecord } from '../lib/json';

/**
 * The `koh-vibe` skill: what a Claude Code conversation needs to know to act
 * on the dashboard — its folders, their rules, its files. Shipped in the
 * package (`skill/koh-vibe`), copied into Claude Code's skills folder.
 *
 * Copied, never linked: the extension's folder carries its version in its
 * name and disappears at the next update — the same reason the hooks point at
 * `~/.koh-vibe/bin`, never at the extension.
 *
 * The extension owns the copy and replaces it with each version. What it
 * never does: write the skill without a yes (the first install goes through
 * Install hooks, a gesture of the user's), overwrite a copy the user edited,
 * or put back a copy the user deleted. The marker — the hash of what was last
 * written — is what tells those cases apart.
 *
 * Synchronous on purpose: the install script is plain CommonJS with no top
 * level `await`, and the skill is two small files.
 */
export interface SkillPaths {
  /** The skill in the package. */
  source: string;
  /** Its copy, `<skills dir>/koh-vibe`. */
  target: string;
  /** What was last written, under the Koh-Vibe root. */
  marker: string;
  /** Where an edited copy goes before it is replaced. */
  backups: string;
}

export const SKILL_NAME = 'koh-vibe';

/** Claude Code's skills folder: `$CLAUDE_CONFIG_DIR/skills`, else `~/.claude/skills`. */
export function claudeSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  const config = env['CLAUDE_CONFIG_DIR'];
  return join(config !== undefined && config.length > 0 ? config : join(env['HOME'] ?? '', '.claude'), 'skills');
}

export function skillPaths(extensionPath: string, home: string, env: NodeJS.ProcessEnv = process.env): SkillPaths {
  return {
    source: join(extensionPath, 'skill', SKILL_NAME),
    target: join(claudeSkillsDir(env), SKILL_NAME),
    marker: join(home, 'skill.json'),
    backups: join(home, 'backups'),
  };
}

/**
 * - `installed` / `updated`: the copy was written.
 * - `unchanged`: it already matched, or there was nothing new to offer.
 * - `edited`: a newer version exists, but the copy there is not the one we
 *   wrote — edited by hand, or another skill of that name: left alone.
 * - `absent`: nothing installed, or deleted by hand — nothing written.
 */
export type SkillOutcome = 'installed' | 'updated' | 'unchanged' | 'edited' | 'absent';

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

/** One hash for a whole folder: paths and contents, in a stable order. */
function hashDir(dir: string): string {
  const h = createHash('sha256');
  for (const rel of files(dir)) {
    h.update(rel).update('\0').update(readFileSync(join(dir, rel))).update('\0');
  }
  return h.digest('hex');
}

/** `hash`: what was last written. `declined`: the shipped version the user chose not to take. */
interface Marker {
  hash: string;
  declined?: string;
}

function readMarker(path: string): Marker | undefined {
  try {
    const root: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(root) || typeof root['hash'] !== 'string') return undefined;
    const declined = root['declined'];
    return typeof declined === 'string' ? { hash: root['hash'], declined } : { hash: root['hash'] };
  } catch {
    return undefined;
  }
}

function writeMarker(path: string, marker: Marker): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, ...marker }, null, 2)}\n`);
}

/** Written beside the target and renamed over it: a session starting meanwhile sees one version, whole. */
function copy(p: SkillPaths): void {
  const tmp = `${p.target}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(p.source, tmp, { recursive: true });
  rmSync(p.target, { recursive: true, force: true });
  renameSync(tmp, p.target);
  writeMarker(p.marker, { hash: hashDir(p.target) });
}

/** What to do with a copy already there, ours or not. */
function update(p: SkillPaths, marker: Marker | undefined): SkillOutcome {
  const shipped = hashDir(p.source);
  const there = hashDir(p.target);
  // Already the shipped version; or edited since, with nothing newer to
  // offer — a hand-edited copy is not news until there is something to lose.
  if (there === shipped || shipped === marker?.hash) return 'unchanged';
  if (marker === undefined || there !== marker.hash) return 'edited';
  copy(p);
  return 'updated';
}

/** The first install, and every one after it: the user asked. */
export function installSkill(p: SkillPaths): SkillOutcome {
  if (!existsSync(p.target)) {
    copy(p);
    return 'installed';
  }
  return update(p, readMarker(p.marker));
}

/**
 * At each start of the extension: follows the new version, only where the
 * skill was installed and is still there.
 */
export function refreshSkill(p: SkillPaths): SkillOutcome {
  const marker = readMarker(p.marker);
  if (marker === undefined) return 'absent';
  if (!existsSync(p.target)) {
    // Deleted by hand: that is a no, and it stays one.
    rmSync(p.marker, { force: true });
    return 'absent';
  }
  const outcome = update(p, marker);
  // « Keep mine », already answered for this very version.
  return outcome === 'edited' && marker.declined === hashDir(p.source) ? 'unchanged' : outcome;
}

/** « Keep mine »: not offered again until the next version. */
export function declineSkill(p: SkillPaths): void {
  const marker = readMarker(p.marker);
  if (marker !== undefined) writeMarker(p.marker, { ...marker, declined: hashDir(p.source) });
}

/**
 * The answer to `edited`: the edited copy goes to the backups — nothing of
 * the user's is ever lost — and the shipped one takes its place. Returns
 * where the copy went.
 */
export function replaceSkill(p: SkillPaths, now: () => number = Date.now): string | undefined {
  let backup: string | undefined;
  if (existsSync(p.target)) {
    backup = join(p.backups, `skill-${SKILL_NAME}-${now()}`);
    mkdirSync(p.backups, { recursive: true });
    cpSync(p.target, backup, { recursive: true });
  }
  copy(p);
  return backup;
}

/** Removes the copy we wrote; an edited one stays, but is no longer ours to update. */
export function uninstallSkill(p: SkillPaths): 'removed' | 'edited' | 'absent' {
  const marker = readMarker(p.marker);
  rmSync(p.marker, { force: true });
  if (marker === undefined || !existsSync(p.target)) return 'absent';
  if (hashDir(p.target) !== marker.hash) return 'edited';
  rmSync(p.target, { recursive: true, force: true });
  return 'removed';
}
