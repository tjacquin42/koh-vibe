import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spoolDirs, type SpoolDirs } from '../src/paths';
import {
  createSession,
  ensureDirs,
  readSession,
  readSessions,
  removeSession,
  writeSession,
} from '../src/spool/persist';
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
