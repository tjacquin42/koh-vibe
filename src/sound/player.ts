import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { bundledSoundsDir } from './bundled';
import { librarySoundsDir } from './library';

/**
 * Where sounds are looked for.
 *
 * Four locations, in this order: the system's own, the ones the user has
 * dropped into `~/Library/Sounds` (the place macOS provides for this), the
 * library Koh-Vibe offers to install for them, and the two sounds the
 * package bundles — the only two, see `bundled.ts`.
 *
 * The order follows a single rule: on identical names, the first one found
 * wins, and what the user has placed there themselves must never be
 * supplanted by what we put there. Our two sounds therefore come AFTER the
 * library, which they at least chose to install.
 *
 * The folders are given, not guessed: the package path comes from the
 * extension host. Without a default value, no call can forget the bundled
 * sounds — an omission that would silence the default setting without
 * showing anything abnormal.
 */
export function soundDirs(kohHome: string, extensionPath: string): string[] {
  // `kohHome` is koh-vibe's own root, the one a test can redirect; the user's
  // `~/Library/Sounds` deliberately is not, and comes from the real home.
  return [
    '/System/Library/Sounds',
    join(homedir(), 'Library', 'Sounds'),
    librarySoundsDir(kohHome),
    bundledSoundsDir(extensionPath),
  ];
}

/** What `afplay` knows how to read, and that makes sense as a notification. */
const PLAYABLE = new Set(['.aiff', '.aif', '.wav', '.m4a', '.m4r', '.mp3', '.caf']);

/** What « no sound » means in a setting: an empty string, not an absence. */
export const NO_SOUND = '';

/** Default volume: audible without startling. */
export const DEFAULT_VOLUME = 0.5;

export interface SoundEntry {
  name: string;
  path: string;
}

/**
 * The available sounds, read from the machine rather than hard-coded: the
 * list varies from one macOS version to the next, and the user can add
 * their own.
 *
 * A missing or unreadable folder is never an error — on another system,
 * both are, and the list is simply empty.
 *
 * Name collisions are resolved in favor of the FIRST folder found, hence
 * the system one: a personal file with the same name does not silently
 * replace a sound the user believes they know.
 */
export async function availableSounds(dirs: readonly string[]): Promise<SoundEntry[]> {
  const seen = new Map<string, SoundEntry>();
  for (const dir of dirs) {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (!PLAYABLE.has(ext)) continue;
      const name = basename(file, extname(file));
      if (!seen.has(name)) seen.set(name, { name, path: join(dir, file) });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/**
 * Clamps a volume to what `afplay` accepts. A missing or nonsensical value
 * falls back to the default rather than to silence: a corrupted setting must
 * not translate into « the sound doesn't work anymore », which would send
 * someone looking for the fault elsewhere.
 */
export function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/**
 * Plays a file, and never fails loudly: a missed chime must not bubble up
 * an error — the dashboard stays usable without sound.
 *
 * `execFile`, not `exec`: the path comes from a setting, hence from the
 * outside, and must never go through a shell.
 */
export function playFile(path: string, volume: number): void {
  execFile('/usr/bin/afplay', ['-v', String(clampVolume(volume)), path], () => undefined);
}

/** Plays a sound by its name, resolving it within the known folders. */
export async function playNamed(
  name: string,
  volume: number,
  dirs: readonly string[],
): Promise<void> {
  if (name === NO_SOUND) return;
  const found = (await availableSounds(dirs)).find((s) => s.name === name);
  if (found !== undefined) playFile(found.path, volume);
}
