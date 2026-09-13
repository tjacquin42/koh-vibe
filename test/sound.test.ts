import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chimeFor, statusesOf } from '../src/sound/model';
import { availableSounds, clampVolume, DEFAULT_VOLUME, NO_SOUND, playFile, playNamed, soundDirs } from '../src/sound/player';
import { kohVibeHome } from '../src/paths';
import { FooterTree, soundRowLabel, volumeRowLabel } from '../src/ui/footer-tree';
import type { Session, Status } from '../src/events/types';

const ROOT = join(__dirname, '..');

const session = (id: string, status: Status): Session => ({
  id, cwd: '/Users/dev/projet', project: 'projet', origin: 'vscode',
  status, toolCount: 0, lastEventAt: 0,
});

const map = (...pairs: Array<[string, Status]>): Map<string, Session> =>
  new Map(pairs.map(([id, s]) => [id, session(id, s)]));

const at = (...pairs: Array<[string, Status]>): Map<string, Status> => statusesOf(map(...pairs));

describe('chimeFor', () => {
  it('distinguishes the two events, for two different sounds', () => {
    expect(chimeFor(at(['s1', 'running']), at(['s1', 'waiting']))).toEqual({ event: 'waiting', sessionId: 's1' });
    expect(chimeFor(at(['s1', 'running']), at(['s1', 'done_unseen']))).toEqual({ event: 'done', sessionId: 's1' });
  });

  it('does not chime for transitions that happen on their own', () => {
    // A session goes from working to idle on its own: a chime at every such
    // step would become background noise, and so a dead signal.
    expect(chimeFor(at(['s1', 'running']), at(['s1', 'idle']))).toBeUndefined();
    expect(chimeFor(at(['s1', 'waiting']), at(['s1', 'running']))).toBeUndefined();
  });

  it('does not chime when nothing changes', () => {
    expect(chimeFor(at(['s1', 'waiting']), at(['s1', 'waiting']))).toBeUndefined();
  });

  it('NEVER chimes on the first render', () => {
    // Otherwise the editor would chime on every window opening, for sessions
    // sometimes hours old.
    expect(chimeFor(undefined, at(['s1', 'waiting'], ['s2', 'done_unseen']))).toBeUndefined();
  });

  it('does not chime for a session we discover: we do not know where it came from', () => {
    expect(chimeFor(at(['s1', 'running']), at(['s1', 'running'], ['s2', 'waiting']))).toBeUndefined();
  });

  it('plays only one sound per tick, and « waiting for you » wins', () => {
    // Two simultaneous chimes are not heard any better than one; the one
    // that asks for something goes ahead of the one that merely informs.
    expect(chimeFor(at(['s1', 'running'], ['s2', 'running']), at(['s1', 'done_unseen'], ['s2', 'waiting']))?.event).toBe('waiting');
    expect(chimeFor(at(['s1', 'running'], ['s2', 'running']), at(['s1', 'waiting'], ['s2', 'done_unseen']))).toEqual({ event: 'waiting', sessionId: 's1' });
  });

  it('ignores a session that has disappeared', () => {
    expect(chimeFor(at(['s1', 'waiting']), at())).toBeUndefined();
  });
});

describe('availableSounds', () => {
  const seeded = (files: string[]): string => {
    const dir = mkdtempSync(join(tmpdir(), 'koh-sons-'));
    for (const f of files) writeFileSync(join(dir, f), '', 'utf8');
    return dir;
  };

  it('lists the playable sounds, without extension and sorted', async () => {
    const dir = seeded(['Ping.aiff', 'Basso.wav', 'Glass.m4a', 'notes.txt', 'doc.pdf']);
    expect((await availableSounds([dir])).map((s) => s.name)).toEqual(['Basso', 'Glass', 'Ping']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('merges several folders: the system one and the user\'s own', async () => {
    const systeme = seeded(['Ping.aiff']);
    const perso = seeded(['MonSon.wav']);
    expect((await availableSounds([systeme, perso])).map((s) => s.name)).toEqual(['MonSon', 'Ping']);
    rmSync(systeme, { recursive: true, force: true });
    rmSync(perso, { recursive: true, force: true });
  });

  it('on a name clash, keeps the one from the first folder — the system one', async () => {
    // A personal file must not silently replace a sound the user believes
    // they know.
    const systeme = seeded(['Ping.aiff']);
    const perso = seeded(['Ping.wav']);
    const found = await availableSounds([systeme, perso]);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe(join(systeme, 'Ping.aiff'));
    rmSync(systeme, { recursive: true, force: true });
    rmSync(perso, { recursive: true, force: true });
  });

  it('ignores an absent folder without losing the others', async () => {
    const dir = seeded(['Ping.aiff']);
    expect((await availableSounds(['/dossier/absent', dir])).map((s) => s.name)).toEqual(['Ping']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds real sounds on this machine', async () => {
    // A real-world anchor: if macOS moved its sounds, a hardcoded list
    // would not catch it.
    expect((await availableSounds(soundDirs(kohVibeHome(), ROOT))).length).toBeGreaterThan(0);
  });
});

describe('clampVolume', () => {
  it('brings the value back within bounds', () => {
    expect(clampVolume(0.3)).toBe(0.3);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(9)).toBe(1);
  });

  it('falls back to the default value, never to silence', () => {
    // A corrupted setting must not translate into "the sound no longer
    // works", which would send someone looking for the fault elsewhere.
    for (const bad of [undefined, null, 'fort', Number.NaN]) {
      expect(clampVolume(bad)).toBe(DEFAULT_VOLUME);
    }
  });
});

describe('playback', () => {
  it('launches nothing when no sound is chosen', async () => {
    await expect(playNamed(NO_SOUND, 0.5, [])).resolves.toBeUndefined();
  });

  it('does not throw on an unknown sound', async () => {
    await expect(playNamed('SonQuiNExistePas', 0.5, ['/dossier/absent'])).resolves.toBeUndefined();
  });

  it('does not throw on a nonexistent file', () => {
    expect(() => playFile('/dossier/absent/rien.aiff', 0.5)).not.toThrow();
  });
});

describe('footer labels', () => {
  it('state the current status rather than a vague invitation', () => {
    expect(soundRowLabel('waiting', 'Ping')).toBe("Waiting sound: Ping");
    expect(soundRowLabel('done', NO_SOUND)).toBe('Finished sound: none');
    expect(volumeRowLabel(0.5)).toBe('Volume: 50 %');
    expect(volumeRowLabel(0)).toBe('Volume: 0 %');
  });
});

describe('FooterTree — the view pinned at the bottom', () => {
  const footer = (): FooterTree => {
    const f = new FooterTree();
    f.setSound({ waiting: 'Ping', done: 'Glass', volume: 0.4 });
    return f;
  };

  it('exposes the list settings and the sound ones, and nothing else — usage has its own view', () => {
    expect(footer().getChildren().map((n) => n.kind)).toEqual([
      'toggle', 'toggle', 'toggle', 'sound', 'sound', 'volume', 'library',
    ]);
  });

  it('makes every row clickable, to its own command', () => {
    const f = footer();
    expect(f.getChildren().map((n) => f.getTreeItem(n).command?.command)).toEqual([
      'kohVibe.toggleSetting',
      'kohVibe.toggleSetting',
      'kohVibe.toggleSetting',
      'kohVibe.chooseSound',
      'kohVibe.chooseSound',
      'kohVibe.chooseVolume',
      'kohVibe.installSounds',
    ]);
  });

  it('the library row toggles between installing and removing', () => {
    // The same row states the status AND the action: offering « install »
    // while the library is already there would send someone looking for a
    // second copy.
    const f = footer();
    f.setLibrary(100);
    const row = f.getChildren().find((n) => n.kind === 'library')!;
    expect(f.getTreeItem(row).label).toBe('Sound library: 100 sounds');
    expect(f.getTreeItem(row).command?.command).toBe('kohVibe.removeSounds');
  });

  it('tells the command which event it is about', () => {
    const f = footer();
    const [, , , waiting, done] = f.getChildren();
    expect(f.getTreeItem(waiting!).command?.arguments).toEqual(['waiting']);
    expect(f.getTreeItem(done!).command?.arguments).toEqual(['done']);
  });

  it('gives an explicit color to every dot, as everywhere else', () => {
    const f = footer();
    for (const node of f.getChildren()) {
      const icon = f.getTreeItem(node).iconPath as { color?: { id: string } };
      expect(icon.color?.id).toBeTruthy();
    }
  });

  it('has no children at all: it is a list, not a tree', () => {
    const f = footer();
    for (const node of f.getChildren()) expect(f.getChildren(node)).toEqual([]);
  });

  it('reports nothing when nothing has changed', () => {
    // Same rule as the sessions tree: the render runs every two seconds,
    // and reporting for nothing would sweep the tooltip out from under
    // the mouse.
    const f = new FooterTree();
    f.setSound({ waiting: 'Ping', done: '', volume: 0.5 });
    let heard = 0;
    f.onDidChangeTreeData(() => {
      heard += 1;
    });
    for (let i = 0; i < 5; i++) f.setSound({ waiting: 'Ping', done: '', volume: 0.5 });
    expect(heard).toBe(0);
    f.setSound({ waiting: 'Glass', done: '', volume: 0.5 });
    expect(heard).toBe(1);
  });
});
