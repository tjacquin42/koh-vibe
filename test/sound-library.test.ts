import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  installedCount,
  installLibrary,
  LIBRARY,
  libraryLabel,
  librarySoundsDir,
  removeLibrary,
  type LibraryDeps,
} from '../src/sound/library';
import { soundDirs } from '../src/sound/player';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'koh-lib-'));

/**
 * A fake archive: `extract` drops the requested files where `installLibrary`
 * will look for them. The real `tar` is not in the loop — what is exercised
 * here is the naming and the count, not the unpacking.
 */
const fake = (files: string[]): LibraryDeps & { work?: string } => {
  const deps: LibraryDeps & { work?: string } = {
    download: async () => new Uint8Array([1, 2, 3]),
    extract: async (_archive, into) => {
      deps.work = into;
      const dir = join(into, 'repo-sha', 'addons', 'kenney_interface_sounds');
      mkdirSync(dir, { recursive: true });
      for (const f of files) writeFileSync(join(dir, f), 'audio', 'utf8');
    },
  };
  return deps;
};

describe('libraryLabel', () => {
  it('gives a readable name, stable from one install to the next', () => {
    expect(libraryLabel('select_003.wav')).toBe('Sélection 3');
    expect(libraryLabel('confirmation_001.wav')).toBe('Confirmation 1');
    expect(libraryLabel('/ailleurs/toggle_004.wav')).toBe('Interrupteur 4');
  });

  it('discards what it cannot name rather than making something up', () => {
    // An unknown family would produce a « bong_001 » line in the choice
    // list: a slightly shorter library is preferable.
    expect(libraryLabel('inconnu_001.wav')).toBeUndefined();
    expect(libraryLabel('select.wav')).toBeUndefined();
    expect(libraryLabel('select_abc.wav')).toBeUndefined();
    expect(libraryLabel('select_000.wav')).toBeUndefined();
  });
});

describe('the library on offer', () => {
  it('is pinned to a commit, never to a branch', () => {
    // A third-party repo can change its mind. "The library changed under our
    // feet" would only show up once a sound stops sounding like what the
    // user had chosen.
    expect(LIBRARY.url).toMatch(/\/[0-9a-f]{40}$/);
    expect(LIBRARY.url).not.toMatch(/master|main|HEAD/);
  });

  it('states its license and author: that is what authorizes the copy', () => {
    expect(LIBRARY.license).toBe('CC0 1.0');
    expect(LIBRARY.author.length).toBeGreaterThan(0);
  });

  it('lands in our own folder, not in the system sound folder', () => {
    // ~/Library/Sounds is read by macOS's Sound panel: dumping a hundred
    // files there would make its list unusable for a setting that only
    // concerns this extension.
    expect(librarySoundsDir('/racine')).toBe(join('/racine', 'sounds'));
    expect(librarySoundsDir('/racine')).not.toContain('Library');
  });

  it('comes AFTER the user folders, so it never overrides one of their sounds', () => {
    // It no longer brings up the rear: the bundle's two sounds now follow
    // it, because installing the library is still a choice, bundling it
    // is not.
    const dirs = soundDirs('/racine', '/ext');
    expect(dirs.indexOf(librarySoundsDir('/racine'))).toBeGreaterThan(dirs.findIndex((d) => d.includes('Library')));
  });
});

describe('installLibrary', () => {
  it('lays down the sounds under their readable name, and counts right', async () => {
    const target = join(scratch(), 'sounds');
    const deps = fake(['select_003.wav', 'error_002.wav', 'LICENSE.txt']);
    expect(await installLibrary(target, deps)).toBe(2);
    expect(readdirSync(target).sort()).toEqual(['Erreur 2.wav', 'Sélection 3.wav']);
    rmSync(target, { recursive: true, force: true });
  });

  it('does not install what it cannot name', async () => {
    const target = join(scratch(), 'sounds');
    expect(await installLibrary(target, fake(['select_001.wav', 'zarbi_001.wav']))).toBe(1);
    expect(readdirSync(target)).toEqual(['Sélection 1.wav']);
    rmSync(target, { recursive: true, force: true });
  });

  it('returns zero when the archive is out of reach, without creating anything', async () => {
    // Network down: the dashboard must stay usable without sound.
    const target = join(scratch(), 'sounds');
    const deps: LibraryDeps = { download: async () => undefined, extract: fake([]).extract };
    expect(await installLibrary(target, deps)).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  it('returns zero when unpacking fails, without throwing', async () => {
    const target = join(scratch(), 'sounds');
    const deps: LibraryDeps = {
      download: async () => new Uint8Array([1]),
      extract: async () => {
        throw new Error('tar introuvable');
      },
    };
    await expect(installLibrary(target, deps)).resolves.toBe(0);
  });

  it('cleans up its temporary folder, on success as on failure', async () => {
    // The archive is close to two megabytes: a failure must not leave it
    // behind, run after run.
    const target = join(scratch(), 'sounds');
    const ok = fake(['select_001.wav']);
    await installLibrary(target, ok);
    expect(ok.work).toBeDefined();
    expect(existsSync(ok.work as string)).toBe(false);

    const ko = fake(['select_001.wav']);
    const boom: LibraryDeps = {
      download: ko.download,
      extract: async (archive, into) => {
        await ko.extract(archive, into);
        throw new Error('boum');
      },
    };
    await installLibrary(target, boom);
    expect(existsSync(ko.work as string)).toBe(false);
    rmSync(target, { recursive: true, force: true });
  });
});

describe('installedCount and removeLibrary', () => {
  it('count what is in place, and a missing folder is worth zero', async () => {
    const target = join(scratch(), 'sounds');
    expect(await installedCount(target)).toBe(0);
    await installLibrary(target, fake(['select_001.wav', 'error_001.wav']));
    expect(await installedCount(target)).toBe(2);
    rmSync(target, { recursive: true, force: true });
  });

  it('removes the whole library, and says how many', async () => {
    const target = join(scratch(), 'sounds');
    await installLibrary(target, fake(['select_001.wav', 'error_001.wav']));
    expect(await removeLibrary(target)).toBe(2);
    expect(existsSync(target)).toBe(false);
    // Twice in a row: removing what is no longer there must not throw.
    expect(await removeLibrary(target)).toBe(0);
  });

  it('says zero when nothing could be removed', async () => {
    // A folder nobody may write to: every unlink fails. The count used to be
    // taken BEFORE the removal, and "2 sounds removed" was announced over two
    // files still on disk.
    const target = join(scratch(), 'sounds');
    await installLibrary(target, fake(['select_001.wav', 'error_001.wav']));
    chmodSync(target, 0o555);
    try {
      expect(await removeLibrary(target)).toBe(0);
      expect(await installedCount(target)).toBe(2);
    } finally {
      chmodSync(target, 0o755);
      rmSync(target, { recursive: true, force: true });
    }
  });
});

