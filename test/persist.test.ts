import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spoolDirs, type SpoolDirs } from '../src/paths';
import {
  createSession,
  ensureDirs,
  hideSession,
  readSession,
  readSessions,
  removeSession,
  writeSession,
} from '../src/spool/persist';
import { shownSession } from '../src/claude/dormant';
import { reduceAll } from '../src/store/reduce';
import type { Session, SpoolEvent } from '../src/events/types';

let home: string;
let dirs: SpoolDirs;

const session = (id: string): Session => ({
  id, cwd: '/x', project: 'x', origin: 'vscode',
  status: 'running', toolCount: 3, lastEventAt: 42,
});

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'koh-'));
  dirs = spoolDirs(home);
  await ensureDirs(dirs);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('persist', () => {
  it('écrit puis relit une session', async () => {
    await writeSession(dirs, session('a'));
    const back = await readSessions(dirs);
    expect(back.get('a')).toEqual(session('a'));
  });

  // `dormant` marque une surimpression : l'onglet que CETTE fenêtre a restauré,
  // recalculé à chaque rendu depuis le mémento de l'éditeur. Écrit sur disque,
  // il survivrait à la fermeture de l'onglet qu'il décrit, et la conversation
  // resterait à jamais « un onglet restauré » — impossible à rouvrir. La règle
  // vit ici, à la seule porte qui mène au disque, plutôt que chez chaque appelant.
  it("n'écrit jamais le drapeau dormant, qui n'appartient qu'à la fenêtre qui l'a calculé", async () => {
    await writeSession(dirs, { ...session('s1'), dormant: true, endedAt: 42 });
    const back = await readSession(dirs, 's1');
    expect(back?.dormant).toBeUndefined();
    // Tout le reste passe intact.
    expect(back?.endedAt).toBe(42);
  });

  it("ignore un drapeau dormant déjà présent sur le disque, plutôt que de le propager", async () => {
    // Un fichier écrit par une version qui ne retirait pas encore le drapeau.
    // Sans cela, la conversation resterait bloquée jusqu'à une réparation à la
    // main : l'invariant doit tenir à la lecture aussi, pas seulement à
    // l'écriture, sinon il ne guérit rien de ce qui existe déjà.
    await writeFile(join(dirs.sessions, 's5.json'), JSON.stringify({ ...session('s5'), dormant: true, endedAt: 7 }), 'utf8');
    expect((await readSession(dirs, 's5'))?.dormant).toBeUndefined();
    expect((await readSessions(dirs)).get('s5')?.dormant).toBeUndefined();
    expect((await readSession(dirs, 's5'))?.endedAt).toBe(7);
  });

  it("createSession ne l'écrit pas davantage — la porte a deux battants", async () => {
    await createSession(dirs, { ...session('s2'), dormant: true });
    expect((await readSession(dirs, 's2'))?.dormant).toBeUndefined();
  });

  it("hideSession, qui réécrit une session lue, ne le réintroduit pas non plus", async () => {
    await writeSession(dirs, { ...session('s3'), dormant: true });
    await hideSession(dirs, 's3');
    const back = await readSession(dirs, 's3');
    expect(back?.dormant).toBeUndefined();
    expect(back?.hidden).toBe(true);
  });

  // La couture qui a réellement cassé : la sortie de `shownSession` — une
  // conversation terminée que l'onglet restauré fait paraître éveillée — repart
  // à l'écriture quand on la met en veille. Chaque module était juste ; c'est
  // leur jonction qui ne l'était pas, et aucun test ne la traversait.
  it("une session affichée éveillée par un onglet restauré reste rouvrable une fois réécrite", async () => {
    const onDisk: Session = { ...session('s4'), endedAt: 10 };
    const restored: Session = { ...session('s4'), dormant: true, lastEventAt: 0 };
    const shown = shownSession(onDisk, restored);
    expect(shown?.dormant).toBe(true); // la vue a bien besoin du drapeau

    // Ce que fait la lune : on la marque terminée et on la réécrit.
    await writeSession(dirs, { ...shown!, endedAt: 99 });

    const back = await readSession(dirs, 's4');
    // Sans quoi le clic prendrait à jamais la branche « onglet restauré » et
    // chercherait à ramener au premier plan un onglet qui n'existe plus.
    expect(back?.dormant).toBeUndefined();
    expect(back?.endedAt).toBe(99);
  });

  it('ne laisse aucun fichier temporaire', async () => {
    await writeSession(dirs, session('a'));
    expect(readdirSync(dirs.sessions).filter((f) => f.startsWith('.tmp'))).toHaveLength(0);
  });

  it('supprime sans lever si le fichier est déjà absent', async () => {
    await expect(removeSession(dirs, 'jamais-vu')).resolves.toBeUndefined();
  });

  it('ignore un fichier de session illisible', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dirs.sessions, 'casse.json'), '{ pas du json');
    await writeSession(dirs, session('a'));
    const back = await readSessions(dirs);
    expect(back.size).toBe(1);
  });

  it('ignore un fichier de session partiellement conforme', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(dirs.sessions, 'incomplet.json'),
      JSON.stringify({ id: 'b', status: 'idle', lastEventAt: 1 }),
    );
    await writeSession(dirs, session('a'));
    const back = await readSessions(dirs);
    expect(back.size).toBe(1);
    expect(back.get('a')).toEqual(session('a'));
    expect(back.has('b')).toBe(false);
  });

  it('ne laisse aucun fichier temporaire même pour des écritures concurrentes sans attente entre elles', async () => {
    // writeSession est exportée et réutilisable : sa sûreté ne doit pas dépendre
    // de la sérialisation qu'un appelant (SpoolWatcher.tick) lui impose par ailleurs.
    await Promise.all([
      writeSession(dirs, session('a')),
      writeSession(dirs, session('a')),
      writeSession(dirs, session('a')),
    ]);
    expect(readdirSync(dirs.sessions).filter((f) => f.startsWith('.tmp'))).toHaveLength(0);
    expect((await readSessions(dirs)).get('a')).toEqual(session('a'));
  });

  describe('readSession', () => {
    it('lit une seule session par id, sans passer par le répertoire entier', async () => {
      await writeSession(dirs, session('a'));
      await writeSession(dirs, session('b'));
      expect(await readSession(dirs, 'a')).toEqual(session('a'));
    });

    it('retourne undefined pour une session absente', async () => {
      expect(await readSession(dirs, 'jamais-vu')).toBeUndefined();
    });

    it('retourne undefined pour un fichier illisible', async () => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(dirs.sessions, 'casse.json'), '{ pas du json');
      expect(await readSession(dirs, 'casse')).toBeUndefined();
    });
  });

  describe('createSession', () => {
    it('writes a session that was absent, and says so', async () => {
      expect(await createSession(dirs, session('a'))).toBe(true);
      expect(await readSession(dirs, 'a')).toEqual(session('a'));
      expect(readdirSync(dirs.sessions).filter((f) => f.startsWith('.tmp'))).toHaveLength(0);
    });

    it('never overwrites a session that exists, however it got there', async () => {
      await writeSession(dirs, { ...session('a'), toolCount: 9 });
      expect(await createSession(dirs, session('a'))).toBe(false);
      expect((await readSession(dirs, 'a'))?.toolCount).toBe(9);
      expect(readdirSync(dirs.sessions).filter((f) => f.startsWith('.tmp'))).toHaveLength(0);
    });
  });

  it('converge : deux ordres de lecture donnent le même état', () => {
    const mk = (event: SpoolEvent['event'], at: number, id: string): SpoolEvent => ({
      event, at, entrypoint: 'cli', termProgram: '', sessionId: id, cwd: '/x',
    });
    const events = [
      mk('SessionStart', 1, 'a'),
      mk('UserPromptSubmit', 2, 'a'),
      mk('PostToolUse', 3, 'a'),
      mk('Stop', 4, 'a'),
    ];
    const forward = reduceAll(events);
    const shuffled = reduceAll([events[2]!, events[0]!, events[3]!, events[1]!]);
    expect(shuffled.get('a')?.status).toBe(forward.get('a')?.status);
    expect(shuffled.get('a')?.toolCount).toBe(forward.get('a')?.toolCount);
  });
});
