import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The version comes from package.json, which is authoritative (CLAUDE.md),
 * captured at build time by scripts/stamp-build.cjs — so it is read from a
 * file, like everything that comes from outside, and validated without a
 * cast.
 */
export function releaseLabel(stamp: unknown): string | undefined {
  if (typeof stamp !== 'object' || stamp === null) return undefined;
  const { version, ahead } = stamp as { version?: unknown; ahead?: unknown };
  if (typeof version !== 'string' || version.length === 0) return undefined;
  // «+7» = seven commits after the last release. A missing or dubious count
  // does not invent a gap: the version alone is shown.
  return typeof ahead === 'number' && ahead > 0 ? `${version}+${ahead}` : version;
}

/**
 * The star says the installed package does not exactly match this commit
 * (see scripts/stamp-build.cjs). A marker with no commit is worthless: the
 * star is never shown on its own.
 */
export function buildCommit(stamp: unknown): string | undefined {
  if (typeof stamp !== 'object' || stamp === null) return undefined;
  const { commit, dirty } = stamp as { commit?: unknown; dirty?: unknown };
  if (typeof commit !== 'string' || commit.length === 0) return undefined;
  return dirty === true ? `${commit}*` : commit;
}

/**
 * What the view shows next to its title: «v0.2.0+7 · 1736ec0».
 *
 * «no version» should no longer be seen now that the manifest is
 * authoritative: it remains for a package built without its stamp, or whose
 * manifest is unreadable. The commit alone already answers the only question
 * being asked — is this really the new package that's running?
 */
export function versionLabel(stamp: unknown): string {
  const release = releaseLabel(stamp) ?? vscode.l10n.t('no version');
  const commit = buildCommit(stamp);
  return commit === undefined ? release : `${release} · ${commit}`;
}

/**
 * Absent or unreadable counts as «no timestamp», never as an error: the same
 * rule as the classification file (groups/store.ts). A package rebuilt
 * outside the repository must still display, not refuse to.
 */
export async function readBuildStamp(extensionPath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(extensionPath, 'build-info.json'), 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}
