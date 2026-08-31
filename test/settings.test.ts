import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  parseSettings,
  serializeSettings,
  settingsFromEditor,
} from '../src/settings/model';
import { DEFAULT_DONE_SOUND, DEFAULT_WAITING_SOUND } from '../src/sound/bundled';
import { readSettings, seedSettings, writeSettings } from '../src/settings/store';
import { settingsFile } from '../src/paths';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'koh-set-'));

describe('parseSettings', () => {
  it('reads what is written', () => {
    expect(parseSettings('{"waiting":"Clic 1","done":"Verre 2","volume":0.3}')).toEqual({
      waiting: 'Clic 1',
      done: 'Verre 2',
      volume: 0.3,
      persistent: true,
      expireTemporary: true,
    });
  });

  it('falls back to the defaults when the file is unreadable', () => {
    expect(parseSettings('pas du json')).toEqual(defaultSettings());
    expect(parseSettings('[]')).toEqual(defaultSettings());
  });

  it('recovers each field SEPARATELY', () => {
    // Un volume abîmé ne doit pas emporter le choix des sons avec lui : sinon
    // une seule valeur fausse fait croire que tout le réglage a été perdu.
    const s = parseSettings('{"waiting":"Clic 1","volume":"beaucoup"}');
    expect(s.waiting).toBe('Clic 1');
    expect(s.volume).toBe(defaultSettings().volume);
  });

  it('keeps a chosen silence, which is not the absence of a choice', () => {
    expect(parseSettings('{"waiting":""}').waiting).toBe('');
  });

  it('round-trips through the file', () => {
    const s = { waiting: 'Clic 1', done: '', volume: 0.9, persistent: false, expireTemporary: true };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });
});

describe('the shared settings file', () => {
  it('lives at the root of the state, beside the filing', () => {
    // C est ce qui le rend commun aux éditeurs : la même machine ne doit pas
    // annoncer deux carillons différents selon la fenêtre d où on la regarde.
    expect(settingsFile('/racine')).toBe(join('/racine', 'settings.json'));
  });

  it('counts as the defaults when it does not exist', async () => {
    expect(await readSettings(join(scratch(), 'absent.json'))).toEqual(defaultSettings());
  });

  it('writes one field without erasing the others', async () => {
    const file = join(scratch(), 'settings.json');
    await writeSettings(file, { waiting: 'Clic 1', done: 'Verre 2', volume: 0.4 });
    await writeSettings(file, { volume: 0.8 });
    expect(await readSettings(file)).toEqual({ waiting: 'Clic 1', done: 'Verre 2', volume: 0.8, persistent: true, expireTemporary: true });
  });

  it('reads before writing: setting the volume does not overwrite a sound chosen meanwhile', async () => {
    const file = join(scratch(), 'settings.json');
    await writeSettings(file, { waiting: 'Clic 1' });
    // Une autre fenêtre écrit pendant qu on tient encore l ancien état en main.
    writeFileSync(file, serializeSettings({ waiting: 'Erreur 3', done: '', volume: 0.5, persistent: true, expireTemporary: true }), 'utf8');
    await writeSettings(file, { volume: 0.2 });
    expect((await readSettings(file)).waiting).toBe('Erreur 3');
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

describe('seedSettings — migrating from each editor own settings', () => {
  it('pours the local settings in when the shared file does not exist yet', async () => {
    const file = join(scratch(), 'settings.json');
    const seeded = await seedSettings(file, () => ({ waiting: 'Funk', done: 'Hero', volume: 0.7, persistent: true, expireTemporary: true }));
    expect(seeded.waiting).toBe('Funk');
    expect(JSON.parse(readFileSync(file, 'utf8')).done).toBe('Hero');
  });

  it('touches NOTHING when the file is already there', async () => {
    // Sans cette garde, chaque démarrage réimposerait les réglages locaux de SON
    // éditeur : les deux ne se contrediraient plus seulement, ils se battraient.
    const file = join(scratch(), 'settings.json');
    await writeSettings(file, { waiting: 'Clic 1', done: 'Verre 2', volume: 0.3 });
    const kept = await seedSettings(file, () => ({ waiting: 'Funk', done: 'Hero', volume: 0.7, persistent: true, expireTemporary: true }));
    expect(kept).toEqual({ waiting: 'Clic 1', done: 'Verre 2', volume: 0.3, persistent: true, expireTemporary: true });
  });

  it('seeds a chosen silence too, which is a setting like any other', async () => {
    const file = join(scratch(), 'settings.json');
    expect((await seedSettings(file, () => ({ waiting: '', done: '', volume: 0.5, persistent: true, expireTemporary: true }))).waiting).toBe('');
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
    expect(kept).toEqual({ waiting: 'Funk', done: '', volume: 0.2, persistent: true, expireTemporary: true });
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
    const s = { ...defaultSettings(), persistent: false, expireTemporary: true };
    expect(parseSettings(serializeSettings(s)).persistent).toBe(false);
  });

  it('reads anything but a boolean as the default, without touching the sounds', () => {
    const s = parseSettings('{"waiting":"Funk","persistent":"non"}');
    expect(s.persistent).toBe(true);
    expect(s.waiting).toBe('Funk');
  });

  it('is written like any other field, and survives a volume change', async () => {
    const file = join(scratch(), 'settings.json');
    await writeSettings(file, { persistent: false, expireTemporary: true });
    await writeSettings(file, { volume: 0.2 });
    expect((await readSettings(file)).persistent).toBe(false);
  });
});

describe('temporary sessions expire — the second checkbox', () => {
  it('is on by default, off when the file says so, and never lost to a bad value', () => {
    expect(defaultSettings().expireTemporary).toBe(true);
    expect(parseSettings('{"expireTemporary":false}').expireTemporary).toBe(false);
    expect(parseSettings('{"expireTemporary":"jamais"}').expireTemporary).toBe(true);
    expect(parseSettings(serializeSettings({ ...defaultSettings(), expireTemporary: false })).expireTemporary).toBe(false);
    expect(settingsFromEditor(() => undefined).expireTemporary).toBe(true);
  });
});
