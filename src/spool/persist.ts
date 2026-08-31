import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpoolDirs } from '../paths';
import type { Origin, Session, Status } from '../events/types';

// Record<Status, true> et Record<Origin, true> : si l'union gagne un membre côté
// events/types.ts sans que ces tables soient mises à jour, la compilation échoue —
// la garde de type ne peut pas dériver silencieusement du contrat de Session.
const STATUSES: Record<Status, true> = {
  running: true,
  waiting: true,
  done_unseen: true,
  idle: true,
  stale: true,
};
const ORIGINS: Record<Origin, true> = {
  vscode: true,
  terminal: true,
  desktop: true,
  sdk: true,
  unknown: true,
};

export async function ensureDirs(dirs: SpoolDirs): Promise<void> {
  for (const dir of [dirs.events, dirs.sessions, dirs.requests, dirs.rejected, dirs.backups]) {
    await mkdir(dir, { recursive: true });
  }
}

// `process.pid` seul n'est pas unique par appel : cette fonction est exportée
// et réutilisable, rien ne garantit qu'un appelant la sérialise (aujourd'hui
// SpoolWatcher.tick() le fait, mais c'est une propriété de l'appelant, pas de
// la fonction). Même compteur synchrone qu'`appendLocalEvent`.
let writeSessionSeq = 0;

/**
 * Écriture atomique : un lecteur concurrent voit l'ancien fichier ou le nouveau,
 * jamais un fichier à moitié écrit.
 */
export async function writeSession(dirs: SpoolDirs, s: Session): Promise<void> {
  const seq = (writeSessionSeq += 1);
  const target = join(dirs.sessions, `${s.id}.json`);
  const tmp = join(dirs.sessions, `.tmp-${s.id}-${process.pid}-${seq}`);
  // `dormant` n'est pas un état de la conversation : c'est ce que CETTE fenêtre
  // sait de son onglet, recalculé à chaque rendu depuis le mémento de l'éditeur
  // (claude/dormant.ts). Écrit ici, il survivrait à la fermeture de l'onglet
  // qu'il décrit, et la conversation resterait à jamais « un onglet restauré » :
  // le clic tenterait de ramener au premier plan un onglet qui n'existe plus,
  // et elle deviendrait impossible à rouvrir. La règle est posée à la porte
  // plutôt que chez les appelants — il suffit d'un qui l'oublie.
  const { dormant: _perWindow, ...persisted } = s;
  await writeFile(tmp, JSON.stringify(persisted), 'utf8');
  await rename(tmp, target);
}

/**
 * Writes a session ONLY if none exists under that id, and says whether it did.
 *
 * `writeSession` replaces; this one refuses. It is what a rescan needs: the
 * file may appear between "is it there?" and "then write it" — a drain in
 * another window reducing a hook of that very session — and replacing it
 * would trade a real state (running, seven tools in) for an idle skeleton.
 * `link` is the atomic exclusive create: the target either appears complete
 * or not at all, and EEXIST is the honest answer rather than an error. The
 * temporary file is removed either way.
 */
export async function createSession(dirs: SpoolDirs, s: Session): Promise<boolean> {
  const seq = (writeSessionSeq += 1);
  const target = join(dirs.sessions, `${s.id}.json`);
  const tmp = join(dirs.sessions, `.tmp-${s.id}-${process.pid}-${seq}`);
  await writeFile(tmp, JSON.stringify(s), 'utf8');
  try {
    await link(tmp, target);
    return true;
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') return false;
    throw err;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/**
 * Marks a session hidden, in place, and says whether there was one to mark.
 *
 * Hidden rather than removed: a removed file is exactly what the rescan looks
 * for, and the row would be back on the next pass — while the process it
 * describes still runs. The flag survives on disk until a hook clears it
 * (`reduce`) or `SessionEnd` removes the file.
 */
export async function hideSession(dirs: SpoolDirs, id: string): Promise<boolean> {
  const current = await readSession(dirs, id);
  if (current === undefined) return false;
  await writeSession(dirs, { ...current, hidden: true });
  return true;
}

/**
 * Keeps at most `max` ended conversations — the most recently ended ones —
 * and removes the rest. Open conversations are never candidates. Each
 * candidate is re-read just before removal, like every decision in this
 * module: an entry brought back to life meanwhile is not an ended one any
 * more. Returns the ids removed.
 */
export async function capEndedSessions(dirs: SpoolDirs, max: number): Promise<string[]> {
  const all = await readSessions(dirs);
  const ended = [...all.values()]
    .filter((s): s is Session & { endedAt: number } => s.endedAt !== undefined)
    .sort((a, b) => b.endedAt - a.endedAt || (a.id < b.id ? -1 : 1));
  const removed: string[] = [];
  for (const s of ended.slice(max)) {
    const current = await readSession(dirs, s.id);
    if (current === undefined || current.endedAt === undefined) continue;
    await removeSession(dirs, s.id);
    removed.push(s.id);
  }
  return removed;
}

export async function removeSession(dirs: SpoolDirs, id: string): Promise<void> {
  try {
    await unlink(join(dirs.sessions, `${id}.json`));
  } catch {
    // déjà supprimé par une autre fenêtre : bénin
  }
}

function isSession(v: unknown): v is Session {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['id'] === 'string' &&
    typeof o['cwd'] === 'string' &&
    typeof o['project'] === 'string' &&
    typeof o['origin'] === 'string' &&
    o['origin'] in ORIGINS &&
    typeof o['status'] === 'string' &&
    o['status'] in STATUSES &&
    typeof o['toolCount'] === 'number' &&
    typeof o['lastEventAt'] === 'number'
  );
}

/**
 * Lit une seule session par id, sans lister tout `sessions/`. C'est le
 * chemin de lecture utilisé pour réduire un événement : relire l'état de
 * cette session juste avant de la réduire, plutôt que de le tenir depuis un
 * instantané pris avant une suite d'`await` (voir `drain`).
 */
export async function readSession(dirs: SpoolDirs, id: string): Promise<Session | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dirs.sessions, `${id}.json`), 'utf8'));
    return isSession(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function readSessions(dirs: SpoolDirs): Promise<Map<string, Session>> {
  const out = new Map<string, Session>();
  let names: string[];
  try {
    names = await readdir(dirs.sessions);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(dirs.sessions, name), 'utf8'));
      if (isSession(parsed)) out.set(parsed.id, parsed);
    } catch {
      // fichier illisible : on l'ignore, il sera réécrit au prochain événement
    }
  }
  return out;
}
