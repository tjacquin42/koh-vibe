import { commitMerged, readRaw, withFileQueue } from '../lib/shared-file';
import { emptyGroups, type Group, type GroupsState, parseGroups, serializeGroups } from './model';

/** Un classement illisible ou absent vaut « vide » : la vue doit s'afficher quoi qu'il arrive. */
export async function readGroups(file: string): Promise<GroupsState> {
  return toState(await readRaw(file));
}

/**
 * Applique `fn` au classement et l'écrit. L'état est relu **à l'intérieur**, jamais détenu par
 * l'appelant au travers d'un `await` : une autre fenêtre peut avoir classé entre-temps, et son
 * travail ne doit pas être écrasé.
 *
 * Deux mécanismes, pas un — tous deux portés par lib/shared-file.ts, partagés avec l'historique
 * des conversations fermées (closed/store.ts) :
 * 1. `withFileQueue` : deux appels sur le même fichier depuis CE processus ne courent jamais
 *    l'un contre l'autre.
 * 2. `commitMerged` relit toujours juste avant de renommer, à chaque tour de fusion, sans
 *    exception ; si le fichier a changé depuis la fusion (une AUTRE fenêtre a écrit
 *    entre-temps), la fusion est rejouée à partir du nouveau contenu plutôt que d'écraser ce
 *    changement — le dernier tour fusionnant et écrivant l'état le plus frais sans relire une
 *    fois de plus.
 */
export function updateGroups(
  file: string,
  fn: (s: GroupsState) => GroupsState | Promise<GroupsState>,
): Promise<GroupsState> {
  return withFileQueue(file, () => updateGroupsOnce(file, fn));
}

async function updateGroupsOnce(
  file: string,
  fn: (s: GroupsState) => GroupsState | Promise<GroupsState>,
): Promise<GroupsState> {
  const before = toState(await readRaw(file));
  const after = await fn(before);
  return commitMerged(file, 'groups', (latestRaw) => merge(latestRaw, before, after), serializeGroups);
}

function merge(latestRaw: string | undefined, before: GroupsState, after: GroupsState): GroupsState {
  const latest = toState(latestRaw);
  return {
    ...after,
    groups: mergeGroups(latest.groups, before.groups, after.groups),
    assignments: mergeAssignments(latest.assignments, before.assignments, after.assignments),
    sessionOrder: mergeSessionOrder(latest.sessionOrder, before.sessionOrder, after.sessionOrder),
    // Même règle, même raison que les affectations, et une fois par événement :
    // régler le son « terminé » d'UNE conversation ne doit effacer ni son son
    // « t'attend », ni celui qu'une autre fenêtre vient de poser sur une autre.
    sessionSounds: {
      waiting: mergeAssignments(latest.sessionSounds.waiting, before.sessionSounds.waiting, after.sessionSounds.waiting),
      done: mergeAssignments(latest.sessionSounds.done, before.sessionSounds.done, after.sessionSounds.done),
    },
  };
}

function toState(raw: string | undefined): GroupsState {
  return raw === undefined ? emptyGroups() : parseGroups(raw);
}

/** L'ordre n'en fait pas partie : il est recalculé à la fin de la fusion. */
function sameAttributes(a: Group, b: Group): boolean {
  return (
    a.name === b.name &&
    // `order` is deliberately NOT here. It is positional, not an attribute:
    // listing it would make every folder of a reorder count as edited, and
    // `applyEdit` would then push OUR name over a rename another window had
    // just made. Where the sequence goes is decided by `sequence()` below.
    a.color === b.color &&
    a.soundWaiting === b.soundWaiting &&
    a.soundDone === b.soundDone
  );
}

/**
 * Pose sur le dossier le plus frais les attributs de notre édition. Une couleur
 * retirée retire la clé plutôt que d'écrire `undefined` — même règle que
 * `setGroupColor` (model.ts), pour qu'un aller-retour par le fichier ne laisse
 * pas de clé morte derrière lui.
 */
function applyEdit(target: Group, edit: Group): Group {
  const { color: _color, soundWaiting: _waiting, soundDone: _done, ...rest } = target;
  const merged: Group = { ...rest, name: edit.name };
  if (edit.color !== undefined) merged.color = edit.color;
  if (edit.soundWaiting !== undefined) merged.soundWaiting = edit.soundWaiting;
  if (edit.soundDone !== undefined) merged.soundDone = edit.soundDone;
  return merged;
}

function mergeGroups(latest: readonly Group[], before: readonly Group[], after: readonly Group[]): Group[] {
  const added = after.filter((g) => !before.some((b) => b.id === g.id));
  const removed = new Set(before.filter((b) => !after.some((a) => a.id === b.id)).map((b) => b.id));
  // Les dossiers conservés viennent de `latest` — l'état le plus frais, qui peut
  // contenir le travail d'une autre fenêtre — et ne reçoivent de NOTRE édition
  // que les attributs qu'elle a réellement changés. Ne propager que le nom, comme
  // le faisait ce code, perdait en silence tout autre attribut : une couleur
  // posée disparaissait à l'écriture. `sameAttributes` est donc la liste, à tenir
  // à jour, de ce qu'un dossier porte et qu'une fenêtre peut modifier.
  const edited = new Map(
    after.filter((a) => before.some((b) => b.id === a.id && !sameAttributes(b, a))).map((a) => [a.id, a] as const),
  );
  const kept = latest
    .filter((g) => !removed.has(g.id))
    .map((g) => {
      const edit = edited.get(g.id);
      return edit === undefined ? g : applyEdit(g, edit);
    });
  const merged = [...kept, ...added.filter((g) => !kept.some((k) => k.id === g.id))];
  return sequence(merged, before, after).map((g, i) => ({ ...g, order: i }));
}

/**
 * The order the merged folders end up in.
 *
 * Same three-way rule as every attribute: what our edit changed is ours, what
 * it did not comes from the freshest state. Renaming a folder must not drag
 * our own idea of the sequence over a reorder another window has just made —
 * so the sequence only becomes ours when we actually moved something.
 *
 * Without this, `order` was renumbered straight from the position in `latest`,
 * which made a reorder impossible to persist no matter what the caller did.
 */
function sequence(merged: readonly Group[], before: readonly Group[], after: readonly Group[]): Group[] {
  const ours = after.map((g) => g.id);
  const theirs = before.map((g) => g.id);
  if (ours.length === theirs.length && ours.every((id, i) => id === theirs[i])) return [...merged];
  const rank = new Map(ours.map((id, i) => [id, i] as const));
  const at = (g: Group): number => rank.get(g.id) ?? Number.MAX_SAFE_INTEGER;
  // Folders we never saw — created by another window while we were moving ours
  // — go to the end rather than being interleaved at a position our sequence
  // says nothing about.
  return [...merged].sort((a, b) => at(a) - at(b));
}

/**
 * Fusionne les ordres dossier par dossier, jamais en bloc : ranger dans SON
 * dossier ne doit pas effacer l'ordre qu'une autre fenêtre vient de poser dans
 * un AUTRE. Prendre `after.sessionOrder` tel quel, comme le faisait la première
 * version, écrasait tout le reste — le même défaut que la couleur perdue par
 * mergeGroups, à un champ près.
 *
 * Un ordre qu'on n'a pas touché revient de `latest` (l'état le plus frais) ;
 * celui qu'on a changé est le nôtre ; celui qu'on a vidé disparaît.
 */
function mergeSessionOrder(
  latest: Readonly<Record<string, readonly string[]>>,
  before: Readonly<Record<string, readonly string[]>>,
  after: Readonly<Record<string, readonly string[]>>,
): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = { ...latest };
  for (const [key, ids] of Object.entries(after)) {
    if (!sameIds(before[key], ids)) out[key] = ids;
  }
  for (const key of Object.keys(before)) {
    if (after[key] === undefined) delete out[key];
  }
  return out;
}

function sameIds(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function mergeAssignments(
  latest: Readonly<Record<string, string>>,
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = { ...latest };
  for (const [sessionId, groupId] of Object.entries(after)) {
    if (before[sessionId] !== groupId) out[sessionId] = groupId;
  }
  for (const sessionId of Object.keys(before)) {
    if (after[sessionId] === undefined) delete out[sessionId];
  }
  return out;
}
