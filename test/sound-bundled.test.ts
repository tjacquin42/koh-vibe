import { describe, expect, it } from 'vitest';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bundledSoundsDir,
  DEFAULT_DONE_SOUND,
  DEFAULT_WAITING_SOUND,
} from '../src/sound/bundled';
import { availableSounds, soundDirs } from '../src/sound/player';
import { librarySoundsDir } from '../src/sound/library';

const ROOT = join(__dirname, '..');

describe('the two sounds shipped with the extension', () => {
  it('sit under the package they are given, next to the icons', () => {
    expect(bundledSoundsDir('/ext')).toBe(join('/ext', 'resources', 'sounds'));
  });

  it('are named after what they announce, not after where they come from', () => {
    // These names are written into the settings file and shown in the picker.
    // « Chute 3 » said which drawer of the library it came from; it never said
    // when it would ring.
    expect(DEFAULT_WAITING_SOUND).toBe('Attente');
    expect(DEFAULT_DONE_SOUND).toBe('Fin');
  });

  // The test that really counts: a default naming a file the package does not
  // carry shows as a chosen sound in the footer and plays nothing — a fresh
  // install would be silent, and the user would have no reason to suspect the
  // setting rather than their speakers.
  it('name files the package really carries', async () => {
    for (const name of [DEFAULT_WAITING_SOUND, DEFAULT_DONE_SOUND]) {
      const file = join(bundledSoundsDir(ROOT), `${name}.wav`);
      await expect(access(file), file).resolves.toBeUndefined();
    }
  });

  it('are the only two, and are found under exactly those names', async () => {
    // Goes through the same listing as any other sound: proves the extension is
    // one `afplay` knows, and that the file name IS the setting value — a
    // mismatch of one accent would resolve to nothing.
    const found = await availableSounds([bundledSoundsDir(ROOT)]);
    expect(found.map((s) => s.name)).toEqual([DEFAULT_WAITING_SOUND, DEFAULT_DONE_SOUND].sort());
  });

  it('are two distinct sounds: waiting and finished must not be confused', () => {
    expect(DEFAULT_WAITING_SOUND).not.toBe(DEFAULT_DONE_SOUND);
  });

  it('are searched LAST, so nothing of ours ever supplants what the user put there', () => {
    const dirs = soundDirs('/root', '/ext');
    expect(dirs[dirs.length - 1]).toBe(bundledSoundsDir('/ext'));
    expect(dirs.indexOf(bundledSoundsDir('/ext'))).toBeGreaterThan(dirs.indexOf(librarySoundsDir('/root')));
  });
});
