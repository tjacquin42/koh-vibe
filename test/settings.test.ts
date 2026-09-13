import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTING_TOGGLES } from '../src/ui/footer-tree';
import {
  defaultSettings,
  parseSettings,
  serializeSettings,
  settingsFromEditor,
  settingsPatch,
} from '../src/settings/model';
import { DEFAULT_DONE_SOUND, DEFAULT_WAITING_SOUND } from '../src/sound/bundled';
import { readSettings, seedSettings, writeSettings } from '../src/settings/store';
import { settingsFile } from '../src/paths';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'koh-set-'));

describe('parseSettings', () => {
  it('reads back what was written', () => {
    expect(parseSettings('{"waiting":"Clic 1","done":"Verre 2","volume":0.3}')).toEqual({
      waiting: 'Clic 1',
      done: 'Verre 2',
      volume: 0.3,
      persistent: true,
      expireTemporary: true,
      animate: true,
    });
  });

  it('falls back to the default values when the file is unreadable', () => {
    expect(parseSettings('pas du json')).toEqual(defaultSettings());
    expect(parseSettings('[]')).toEqual(defaultSettings());
  });

  it('recovers each field SEPARATELY', () => {
    // A corrupted volume must not drag the sound choice down with it:
    // otherwise a single bad value makes it look like the whole setting
    // was lost.
    const s = parseSettings('{"waiting":"Clic 1","volume":"beaucoup"}');
    expect(s.waiting).toBe('Clic 1');
    expect(s.volume).toBe(defaultSettings().volume);
  });

  it('keeps a chosen silence, which is not an absence of choice', () => {
    expect(parseSettings('{"waiting":""}').waiting).toBe('');
  });

  it('makes the round trip through the file', () => {
    const s = { waiting: 'Clic 1', done: '', volume: 0.9, persistent: false, expireTemporary: true, animate: true };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });
});

describe('the shared settings file', () => {
  it('lives at the root of the state, next to the folder layout', () => {
    // This is what makes it common to every editor: the same machine must
    // not announce two different chimes depending on which window is
    // looking at it.
    expect(settingsFile('/racine')).toBe(join('/racine', 'settings.json'));
  });

  it('is worth the default values when it does not exist', async () => {
    expect(await readSettings(join(scratch(), 'absent.json'))).toEqual(defaultSettings());
  });

  it('writes one field without erasing the others', async () => {
    const file = join(scratch(), 'settings.json');
    await writeSettings(file, { waiting: 'Clic 1', done: 'Verre 2', volume: 0.4 });
    await writeSettings(file, { volume: 0.8 });
    expect(await readSettings(file)).toEqual({ waiting: 'Clic 1', done: 'Verre 2', volume: 0.8, persistent: true, expireTemporary: true, animate: true });
  });

  it('reads before writing: setting the volume does not overwrite a sound chosen in between', async () => {
    const file = join(scratch(), 'settings.json');
    await writeSettings(file, { waiting: 'Clic 1' });
    // Another window writes while we are still holding the old state in hand.
    writeFileSync(file, serializeSettings({ waiting: 'Erreur 3', done: '', volume: 0.5, persistent: true, expireTemporary: true, animate: true }), 'utf8');
    await writeSettings(file, { volume: 0.2 });
    expect((await readSettings(file)).waiting).toBe('Erreur 3');
  });

  it('keeps both fields when two writes from one window overlap', async () => {
    // Two clicks before the first write has landed, or two commands at once.
    // Each used to read the same "before" and write the WHOLE object, so
    // whichever rename came second silently reverted the other's field. Same
    // guarantee, proven the same way, as the folder layout (groups-store).
    const file = join(scratch(), 'settings.json');
    await Promise.all([writeSettings(file, { waiting: 'Clic 1' }), writeSettings(file, { volume: 0.2 })]);
    const s = await readSettings(file);
    expect(s.waiting).toBe('Clic 1');
    expect(s.volume).toBe(0.2);
  });

  it('leaves no temporary file behind', async () => {
    const dir = scratch();
    const file = join(dir, 'settings.json');
    await writeSettings(file, { volume: 0.1 });
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(dir)).toEqual(['settings.json']);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('seedSettings — the migration from each editor\'s own settings', () => {
  it('pours in the local settings when the shared file does not exist yet', async () => {
    const file = join(scratch(), 'settings.json');
    const seeded = await seedSettings(file, () => ({ waiting: 'Funk', done: 'Hero', volume: 0.7, persistent: true, expireTemporary: true, animate: true }));
    expect(seeded.waiting).toBe('Funk');
    expect(JSON.parse(readFileSync(file, 'utf8')).done).toBe('Hero');
  });

  it('touches NOTHING when the file is already there', async () => {
    // Without this guard, every startup would reimpose the local settings of
    // ITS OWN editor: the two would no longer merely contradict each other,
    // they would fight over it.
    const file = join(scratch(), 'settings.json');
    await writeSettings(file, { waiting: 'Clic 1', done: 'Verre 2', volume: 0.3 });
    const kept = await seedSettings(file, () => ({ waiting: 'Funk', done: 'Hero', volume: 0.7, persistent: true, expireTemporary: true, animate: true }));
    expect(kept).toEqual({ waiting: 'Clic 1', done: 'Verre 2', volume: 0.3, persistent: true, expireTemporary: true, animate: true });
  });

  it('seeds even a chosen silence, which is a setting like any other', async () => {
    const file = join(scratch(), 'settings.json');
    expect((await seedSettings(file, () => ({ waiting: '', done: '', volume: 0.5, persistent: true, expireTemporary: true, animate: true }))).waiting).toBe('');
    expect((await readSettings(file)).waiting).toBe('');
  });
});

describe('the sounds a fresh install starts with', () => {
  it('proposes two sounds of the library rather than silence', () => {
    // A dashboard that never chimes teaches nothing about itself: someone who
    // installs the extension has to HEAR the notification once to know it
    // exists, and only then decide to change or mute it.
    expect(defaultSettings().waiting).toBe(DEFAULT_WAITING_SOUND);
    expect(defaultSettings().done).toBe(DEFAULT_DONE_SOUND);
  });

  it('never replaces a sound already chosen', () => {
    // The whole point of a default: it fills a hole, it does not overwrite.
    // An upgrade that reset the chime to ours would be the one bug the user
    // would never forgive — a setting they had chosen, gone without a word.
    expect(parseSettings('{"waiting":"Funk","done":"Hero","volume":0.3}')).toEqual({
      waiting: 'Funk',
      done: 'Hero',
      volume: 0.3,
      persistent: true,
      expireTemporary: true,
      animate: true,
    });
  });

  it('leaves a chosen silence silent, on both events', () => {
    // Empty string is a CHOICE ("None" in the picker), not an absence of one.
    // A default that read it as a hole would put the sound back on, for the one
    // user who had deliberately asked for quiet.
    const s = parseSettings('{"waiting":"","done":"","volume":0.5}');
    expect(s.waiting).toBe('');
    expect(s.done).toBe('');
  });

  it('fills in the event a file never mentions', () => {
    const s = parseSettings('{"waiting":"Funk"}');
    expect(s.waiting).toBe('Funk');
    expect(s.done).toBe(DEFAULT_DONE_SOUND);
  });
});

describe('settingsFromEditor — what the migration reads from this editor', () => {
  it('carries over what the editor had, a chosen silence included', () => {
    const stored: Record<string, unknown> = {
      'sound.waiting': 'Funk',
      'sound.done': '',
      'sound.volume': 0.7,
    };
    expect(settingsFromEditor((key) => stored[key])).toEqual({
      waiting: 'Funk',
      done: '',
      volume: 0.7,
      persistent: true,
      expireTemporary: true,
      animate: true,
    });
  });

  it('falls back to the defaults when this editor never had a setting', () => {
    // This is the path a FRESH install takes: no VSCode setting to migrate, so
    // the seeded file must carry the defaults. Reading a missing setting as
    // silence would freeze that silence into the shared file on first launch,
    // and no new install would ever chime.
    expect(settingsFromEditor(() => undefined)).toEqual(defaultSettings());
  });
});

describe('a fresh install, end to end', () => {
  it('seeds the shared file with the default sounds when there is nothing to migrate', async () => {
    // The scenario that matters: nobody has ever chosen, and this editor holds
    // no legacy setting either. The seeded file must carry the defaults — it is
    // written once and then left alone forever, so a silence written here would
    // be a silence for good.
    const file = join(scratch(), 'settings.json');
    const seeded = await seedSettings(file, () => settingsFromEditor(() => undefined));
    expect(seeded).toEqual(defaultSettings());
    expect(JSON.parse(readFileSync(file, 'utf8')).waiting).toBe(DEFAULT_WAITING_SOUND);
  });

  it('leaves an upgraded install exactly as its owner left it', async () => {
    // The same run, on a machine where the file is already there: the defaults
    // must not get a second chance at it.
    const file = join(scratch(), 'settings.json');
    await writeSettings(file, { waiting: 'Funk', done: '', volume: 0.2 });
    const kept = await seedSettings(file, () => settingsFromEditor(() => undefined));
    expect(kept).toEqual({ waiting: 'Funk', done: '', volume: 0.2, persistent: true, expireTemporary: true, animate: true });
  });
});

describe('persistent sessions — the setting behind the checkbox', () => {
  it('is on until someone turns it off: a file that never mentions it, a fresh editor', () => {
    expect(defaultSettings().persistent).toBe(true);
    expect(parseSettings('{"waiting":"Funk"}').persistent).toBe(true);
    expect(settingsFromEditor(() => undefined).persistent).toBe(true);
  });

  it('keeps a chosen off, and makes the round trip', () => {
    expect(parseSettings('{"persistent":false}').persistent).toBe(false);
    const s = { ...defaultSettings(), persistent: false, expireTemporary: true, animate: true };
    expect(parseSettings(serializeSettings(s)).persistent).toBe(false);
  });

  it('reads anything but a boolean as the default, without touching the sounds', () => {
    const s = parseSettings('{"waiting":"Funk","persistent":"non"}');
    expect(s.persistent).toBe(true);
    expect(s.waiting).toBe('Funk');
  });

  it('is written like any other field, and survives a volume change', async () => {
    const file = join(scratch(), 'settings.json');
    await writeSettings(file, { persistent: false, expireTemporary: true, animate: true });
    await writeSettings(file, { volume: 0.2 });
    expect((await readSettings(file)).persistent).toBe(false);
  });
});

describe('temporary sessions expire — the second checkbox', () => {
  it('is on by default, off when the file says so, and never lost to a bad value', () => {
    expect(defaultSettings().expireTemporary).toBe(true);
    expect(parseSettings('{"expireTemporary":false}').expireTemporary).toBe(false);
    expect(parseSettings('{"expireTemporary":"jamais"}').expireTemporary).toBe(true);
    expect(parseSettings(serializeSettings({ ...defaultSettings(), expireTemporary: false, animate: true })).expireTemporary).toBe(false);
    expect(settingsFromEditor(() => undefined).expireTemporary).toBe(true);
  });
});

describe('animated status dots — the third checkbox', () => {
  it('turns by default: a file that never mentions it, and a fresh editor', () => {
    expect(defaultSettings().animate).toBe(true);
    expect(parseSettings('{"waiting":"Clic 1"}').animate).toBe(true);
    expect(settingsFromEditor(() => undefined).animate).toBe(true);
  });

  it('keeps a chosen off, and makes the round trip', () => {
    const off = { ...defaultSettings(), animate: false };
    expect(parseSettings(serializeSettings(off)).animate).toBe(false);
  });

  it('reads anything but a boolean as the default, without touching the rest', () => {
    // Each field falls back SEPARATELY: a corrupted animation setting must
    // not drag the sound down with it.
    const s = parseSettings('{"waiting":"Funk","animate":"oui"}');
    expect(s.animate).toBe(true);
    expect(s.waiting).toBe('Funk');
  });
});

describe('settingsPatch — what a checked box writes to the file', () => {
  // The test that was missing, and the bug it would have caught: the wiring
  // wrote `key === 'persistent' ? {persistent} : {expireTemporary}`, a
  // BINARY ternary over a union that counts three. Checking « Animated
  // dots » toggled « Temporary conversations expire », and nothing ever
  // wrote `animate`. TypeScript could not say anything: a ternary over
  // three cases remains perfectly valid.
  //
  // The loop starts from SETTING_TOGGLES rather than a list written here: a
  // fourth toggle added tomorrow is covered the day it is added, without
  // anyone having to think about it.
  it('writes the requested toggle, and only that one', () => {
    for (const key of SETTING_TOGGLES) {
      for (const on of [true, false]) {
        expect(settingsPatch(key, on), `${key} → ${String(on)}`).toEqual({ [key]: on });
      }
    }
  });

  it('covers every toggle of the settings view, with no exception', () => {
    // A toggle `settingsPatch` could not name would produce an inert box,
    // or worse, a box that changes another one.
    for (const key of SETTING_TOGGLES) {
      expect(Object.keys(settingsPatch(key, true)), `${key}`).toEqual([key]);
    }
  });

  it('produces a patch that writeSettings can merge without losing anything', () => {
    const base = defaultSettings();
    for (const key of SETTING_TOGGLES) {
      const merged = { ...base, ...settingsPatch(key, false) };
      expect(merged[key]).toBe(false);
      for (const other of SETTING_TOGGLES.filter((k) => k !== key)) {
        expect(merged[other], `${key} ne doit pas toucher ${other}`).toBe(base[other]);
      }
    }
  });
});
