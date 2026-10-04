import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

/**
 * A library that is offered, never imposed, and practically never bundled.
 *
 * Bundling a hundred audio files into the package would have two costs: the
 * weight, and the license of each one in a public repository. So they are
 * fetched on demand, once, if the user wants them. Two of them are the
 * exception and do travel in the package — the ones for the default
 * setting, without which a fresh install would be silent; see `bundled.ts`.
 *
 * The choice fell on Kenney's interface sounds: a hundred short sounds (none
 * longer than three tenths of a second), designed for an interface rather
 * than a phone ringtone, and released under CC0 — so usable and
 * redistributable with no condition, which was true of none of the system's
 * tones.
 *
 * The archive is pinned to a COMMIT, never a branch: a third-party
 * repository can change its mind, and "the library changed under our feet"
 * is a defect that would only show up the moment a sound stops resembling
 * what the user had chosen.
 */
export interface LibraryInfo {
  name: string;
  author: string;
  license: string;
  homepage: string;
  url: string;
  /** What the archive is expected to contain: used to announce a number before downloading. */
  count: number;
}

const COMMIT = '4596a49eaf5a533948d49a47467f606bcdea70ff';

export const LIBRARY: LibraryInfo = {
  name: 'Kenney Interface Sounds',
  author: 'Kenney',
  license: 'CC0 1.0',
  homepage: 'https://kenney.nl/assets/interface-sounds',
  url: `https://codeload.github.com/Calinou/kenney-interface-sounds/tar.gz/${COMMIT}`,
  count: 100,
};

/**
 * Where the library lands: in our own place, not in `~/Library/Sounds`.
 *
 * `~/Library/Sounds` is read by macOS's Sound panel: dumping a hundred files
 * there would make the system's alert sound list unusable, for a setting
 * that only concerns this extension. A folder of our own also uninstalls in
 * one gesture, without having to guess which of the files present came from
 * us.
 */
export function librarySoundsDir(home: string): string {
  return join(home, 'sounds');
}

/**
 * The families in the archive, and their plain-text name.
 *
 * A family missing from this table is not installed: better a slightly
 * shorter library than a list showing `bong_001`.
 */
const FAMILIES: Readonly<Record<string, string>> = {
  back: 'Retour',
  bong: 'Bong',
  click: 'Clic',
  close: 'Fermeture',
  confirmation: 'Confirmation',
  drop: 'Chute',
  error: 'Erreur',
  glass: 'Verre',
  glitch: 'Glitch',
  maximize: 'Montée',
  minimize: 'Descente',
  open: 'Ouverture',
  pluck: 'Pincement',
  question: 'Question',
  scratch: 'Scratch',
  scroll: 'Défilement',
  select: 'Sélection',
  switch: 'Bascule',
  tick: 'Tic',
  toggle: 'Interrupteur',
};

/**
 * The name under which a file from the archive enters the library.
 *
 * `select_003.wav` becomes « Sélection 3 »: this is the name that shows up
 * in the picker list AND that gets written into settings, so it has to stay
 * stable from one install to the next — hence a fixed table rather than a
 * neat transformation of the original name, which would shift on the first
 * upstream rename.
 */
export function libraryLabel(file: string): string | undefined {
  const stem = basename(file, extname(file));
  const cut = stem.lastIndexOf('_');
  if (cut <= 0) return undefined;
  const label = FAMILIES[stem.slice(0, cut)];
  if (label === undefined) return undefined;
  const index = Number.parseInt(stem.slice(cut + 1), 10);
  if (!Number.isInteger(index) || index <= 0) return undefined;
  return `${label} ${index}`;
}

export interface LibraryDeps {
  /** Returns the archive's content, or `undefined` if it is out of reach. */
  download: (url: string) => Promise<Uint8Array | undefined>;
  /** Unpacks the archive into a folder. */
  extract: (archive: string, into: string) => Promise<void>;
}

async function download(url: string): Promise<Uint8Array | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

/**
 * `execFile`, not `exec`: the paths are built here, but an archive must
 * never come near a shell, whatever its origin.
 */
function extract(archive: string, into: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/tar', ['-xzf', archive, '-C', into], (err) =>
      err === null ? resolve() : reject(err),
    );
  });
}

const defaultLibraryDeps: LibraryDeps = { download, extract };

async function wavFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await wavFiles(full)));
    else if (extname(entry.name).toLowerCase() === '.wav') out.push(full);
  }
  return out.sort();
}

/** How many library sounds are already in place. */
export async function installedCount(target: string): Promise<number> {
  try {
    return (await readdir(target)).filter((f) => extname(f).toLowerCase() === '.wav').length;
  } catch {
    return 0;
  }
}

/**
 * Fetches the library and installs it. Returns the number of sounds
 * installed.
 *
 * Never throws: network down, `tar` missing, disk full — it all falls back
 * to zero. A missing library does not keep the dashboard from serving, and
 * a failed chime is not worth an error window.
 *
 * The temporary folder is cleaned up no matter what happens: the archive is
 * close to two megabytes, and a failure must not leave them behind.
 */
export async function installLibrary(
  target: string,
  deps: LibraryDeps = defaultLibraryDeps,
): Promise<number> {
  const bytes = await deps.download(LIBRARY.url);
  if (bytes === undefined || bytes.length === 0) return 0;
  let work: string | undefined;
  try {
    work = await mkdtemp(join(tmpdir(), 'koh-vibe-sounds-'));
    const archive = join(work, 'library.tar.gz');
    await writeFile(archive, bytes);
    await deps.extract(archive, work);
    await mkdir(target, { recursive: true });
    let added = 0;
    for (const file of await wavFiles(work)) {
      const label = libraryLabel(file);
      if (label === undefined) continue;
      try {
        // Copy rather than move: the temp folder and the target can live on
        // two different volumes, where `rename` would fail.
        await writeFile(join(target, `${label}.wav`), await readFile(file));
        added += 1;
      } catch {
        continue;
      }
    }
    return added;
  } catch {
    return 0;
  } finally {
    if (work !== undefined) await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Removes the library and says how many sounds actually went.
 *
 * Counted again after the removal rather than assumed from before it: a
 * removal that fails — a folder nobody may write to — used to be announced as
 * "N sounds removed" over N files still on disk. Zero is the honest answer
 * then, and the caller says so.
 */
export async function removeLibrary(target: string): Promise<number> {
  const before = await installedCount(target);
  await rm(target, { recursive: true, force: true }).catch(() => undefined);
  return before - (await installedCount(target));
}
