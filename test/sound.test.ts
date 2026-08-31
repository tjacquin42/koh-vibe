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
  it('tells the two events apart, for two different sounds', () => {
    expect(chimeFor(at(['s1', 'running']), at(['s1', 'waiting']))).toEqual({ event: 'waiting', sessionId: 's1' });
    expect(chimeFor(at(['s1', 'running']), at(['s1', 'done_unseen']))).toEqual({ event: 'done', sessionId: 's1' });
  });

  it('does not chime for the transitions that happen on their own', () => {
    // Une session passe d elle-même de en cours à l arrêt puis à périmée : un
    // carillon à chaque fois deviendrait un bruit de fond, donc un signal mort.
    expect(chimeFor(at(['s1', 'running']), at(['s1', 'idle']))).toBeUndefined();
    expect(chimeFor(at(['s1', 'idle']), at(['s1', 'stale']))).toBeUndefined();
    expect(chimeFor(at(['s1', 'waiting']), at(['s1', 'running']))).toBeUndefined();
  });

  it('does not chime when nothing changes', () => {
    expect(chimeFor(at(['s1', 'waiting']), at(['s1', 'waiting']))).toBeUndefined();
  });

  it('NEVER chimes on the first render', () => {
    // Sinon l éditeur carillonnerait à chaque ouverture de fenêtre, pour des
    // sessions parfois vieilles de plusieurs heures.
    expect(chimeFor(undefined, at(['s1', 'waiting'], ['s2', 'done_unseen']))).toBeUndefined();
  });

  it('does not chime for a session just discovered: where it comes from is unknown', () => {
    expect(chimeFor(at(['s1', 'running']), at(['s1', 'running'], ['s2', 'waiting']))).toBeUndefined();
  });

  it('plays one sound per round, and "waiting for you" wins', () => {
    // Deux carillons simultanés ne s entendent pas mieux qu un ; celui qui
    // demande quelque chose passe devant celui qui informe.
    expect(chimeFor(at(['s1', 'running'], ['s2', 'running']), at(['s1', 'done_unseen'], ['s2', 'waiting']))?.event).toBe('waiting');
    expect(chimeFor(at(['s1', 'running'], ['s2', 'running']), at(['s1', 'waiting'], ['s2', 'done_unseen']))).toEqual({ event: 'waiting', sessionId: 's1' });
  });

  it('ignores a session that is gone', () => {
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

  it('brings several folders together: the system one and the user one', async () => {
    const systeme = seeded(['Ping.aiff']);
    const perso = seeded(['MonSon.wav']);
    expect((await availableSounds([systeme, perso])).map((s) => s.name)).toEqual(['MonSon', 'Ping']);
    rmSync(systeme, { recursive: true, force: true });
    rmSync(perso, { recursive: true, force: true });
  });

  it('on a name clash, keeps the one from the first folder — the system', async () => {
    // Un fichier personnel ne doit pas remplacer en silence un son que
    // l utilisateur croit connaître.
    const systeme = seeded(['Ping.aiff']);
    const perso = seeded(['Ping.wav']);
    const found = await availableSounds([systeme, perso]);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe(join(systeme, 'Ping.aiff'));
    rmSync(systeme, { recursive: true, force: true });
    rmSync(perso, { recursive: true, force: true });
  });

  it('ignores a missing folder without losing the others', async () => {
    const dir = seeded(['Ping.aiff']);
    expect((await availableSounds(['/dossier/absent', dir])).map((s) => s.name)).toEqual(['Ping']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds real sounds on this machine', async () => {
    // Ancrage réel : si macOS déplaçait ses sons, une liste codée en dur ne le
    // dirait pas.
    expect((await availableSounds(soundDirs(kohVibeHome(), ROOT))).length).toBeGreaterThan(0);
  });
});

describe('clampVolume', () => {
  it('brings it back within bounds', () => {
    expect(clampVolume(0.3)).toBe(0.3);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(9)).toBe(1);
  });

  it('falls back to the default value, never to silence', () => {
    // Un réglage abîmé ne doit pas se traduire par « le son ne marche plus »,
    // qui enverrait chercher la panne ailleurs.
    for (const bad of [undefined, null, 'fort', Number.NaN]) {
      expect(clampVolume(bad)).toBe(DEFAULT_VOLUME);
    }
  });
});

describe('playback', () => {
  it('starts nothing when no sound is chosen', async () => {
    await expect(playNamed(NO_SOUND, 0.5, [])).resolves.toBeUndefined();
  });

  it('does not throw on an unknown sound', async () => {
    await expect(playNamed('SonQuiNExistePas', 0.5, ['/dossier/absent'])).resolves.toBeUndefined();
  });

  it('does not throw on a file that does not exist', () => {
    expect(() => playFile('/dossier/absent/rien.aiff', 0.5)).not.toThrow();
  });
});

describe('the footer labels', () => {
  it('say the current state rather than a vague invitation', () => {
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

  it('exposes the two list settings and the sound ones, and nothing else — usage has its own view', () => {
    expect(footer().getChildren().map((n) => n.kind)).toEqual(['toggle', 'toggle', 'sound', 'sound', 'volume', 'library']);
  });

  it('makes every row clickable, towards its own command', () => {
    const f = footer();
    expect(f.getChildren().map((n) => f.getTreeItem(n).command?.command)).toEqual([
      'kohVibe.toggleSetting',
      'kohVibe.toggleSetting',
      'kohVibe.chooseSound',
      'kohVibe.chooseSound',
      'kohVibe.chooseVolume',
      'kohVibe.installSounds',
    ]);
  });

  it('the library row toggles between install and remove', () => {
    // La même ligne dit l état ET l action : proposer « installer » alors que
    // la bibliothèque est là enverrait chercher une deuxième copie.
    const f = footer();
    f.setLibrary(100);
    const row = f.getChildren().find((n) => n.kind === 'library')!;
    expect(f.getTreeItem(row).label).toBe('Sound library: 100 sounds');
    expect(f.getTreeItem(row).command?.command).toBe('kohVibe.removeSounds');
  });

  it('tells the command which event it is about', () => {
    const f = footer();
    const [, , waiting, done] = f.getChildren();
    expect(f.getTreeItem(waiting!).command?.arguments).toEqual(['waiting']);
    expect(f.getTreeItem(done!).command?.arguments).toEqual(['done']);
  });

  it('gives every dot an explicit colour, as everywhere else', () => {
    const f = footer();
    for (const node of f.getChildren()) {
      const icon = f.getTreeItem(node).iconPath as { color?: { id: string } };
      expect(icon.color?.id).toBeTruthy();
    }
  });

  it('has no children: it is a list, not a tree', () => {
    const f = footer();
    for (const node of f.getChildren()) expect(f.getChildren(node)).toEqual([]);
  });

  it('reports nothing when nothing has changed', () => {
    // Même règle que l arbre des sessions : le rendu tourne toutes les deux
    // secondes, et signaler à vide escamote l infobulle sous la souris.
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
