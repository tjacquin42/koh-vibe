import * as vscode from 'vscode';
import type { ChimeEvent } from '../sound/model';
import { isRecord } from '../lib/json';

/** The two events that chime, in the order they are displayed. */
export const CHIME_EVENTS: readonly ChimeEvent[] = ['waiting', 'done'];

/**
 * The folder field that carries an event's sound.
 *
 * Two flat fields rather than one nested object: `store.ts`'s three-way
 * merge compares a folder's attributes one by one, and an object would
 * have forced it to compare them in depth — the kind of detail that gets
 * forgotten, and makes a setting silently disappear.
 */
const GROUP_SOUND: Readonly<Record<ChimeEvent, 'soundWaiting' | 'soundDone'>> = {
  waiting: 'soundWaiting',
  done: 'soundDone',
};

export interface Group {
  id: string;
  name: string;
  order: number;
  /**
   * A color identifier, neutral and stable (« blue », « green »…), never a
   * translated label nor a theme value: the file is shared between
   * editors and has to survive a palette change as well as a language
   * change. The mapping to an actual color lives in ui/colors.ts, and an
   * unknown value shows up there without a color instead of breaking the
   * view.
   */
  color?: string;
  /**
   * This folder's sounds, one per event. They win over the global setting
   * and yield to a conversation's own — see `soundFor`.
   *
   * One sound per event, rather than a single one for the folder:
   * « Folder sound » did not say what it was setting, and the user could
   * not discover it without waiting for an actual trigger.
   */
  soundWaiting?: string;
  soundDone?: string;
}

/** The sounds specific to conversations, arranged by event. */
export type SessionSounds = Readonly<Record<ChimeEvent, Readonly<Record<string, string>>>>;

function emptySessionSounds(): SessionSounds {
  return { waiting: {}, done: {} };
}

export interface GroupsState {
  groups: readonly Group[];
  assignments: Readonly<Record<string, string>>;
  /**
   * The order chosen by hand, folder by folder. A missing key means
   * « no order chosen »: the folder then falls back to the dashboard's
   * sort (status, then freshness). As soon as an order exists, it rules,
   * and the sessions it does not name come after.
   *
   * The `UNFILED` key (empty string) designates « Unfiled »: `parseGroups`
   * refuses any empty identifier, so no real folder can claim it.
   */
  sessionOrder: Readonly<Record<string, readonly string[]>>;
  /** The sound specific to a conversation. The highest priority of the three levels. */
  sessionSounds: SessionSounds;
  /** Fields of the file we do not know: preserved as is on write. */
  unknown: Readonly<Record<string, unknown>>;
}

const KNOWN = new Set(['version', 'groups', 'assignments', 'sessionOrder', 'sessionSounds']);

/** The order key for « Unfiled ». */
const UNFILED = '';

export function emptyGroups(): GroupsState {
  return { groups: [], assignments: {}, sessionOrder: {}, sessionSounds: emptySessionSounds(), unknown: {} };
}

/** `undefined` (« Unfiled ») and the empty string designate the same bucket. */
function orderKey(groupId: string | undefined): string {
  return groupId ?? UNFILED;
}

function name(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Unreadable data means « no sorting »: the view must render no matter what. */
export function parseGroups(raw: string): GroupsState {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return emptyGroups();
  }
  if (!isRecord(root)) return emptyGroups();

  const groups: Group[] = [];
  const seenIds = new Set<string>();
  const rawGroups = root['groups'];
  if (Array.isArray(rawGroups)) {
    for (const [i, g] of rawGroups.entries()) {
      if (!isRecord(g)) continue;
      const id = name(g['id']);
      const label = name(g['name']);
      if (id === undefined || label === undefined) continue;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const order = typeof g['order'] === 'number' && Number.isFinite(g['order']) ? g['order'] : i;
      const color = name(g['color']);
      const group: Group = { id, name: label, order };
      if (color !== undefined) group.color = color;
      for (const event of CHIME_EVENTS) {
        const sound = name(g[GROUP_SOUND[event]]);
        if (sound !== undefined) group[GROUP_SOUND[event]] = sound;
      }
      groups.push(group);
    }
  }
  groups.sort((a, b) => a.order - b.order);

  const ids = new Set(groups.map((g) => g.id));
  const assignments: Record<string, string> = {};
  const rawAssignments = root['assignments'];
  if (isRecord(rawAssignments)) {
    for (const [sessionId, groupId] of Object.entries(rawAssignments)) {
      if (typeof groupId === 'string' && ids.has(groupId)) assignments[sessionId] = groupId;
    }
  }

  // An order is a list of session identifiers, nothing else: a malformed
  // entry is ignored rather than bringing down the whole read. Identifiers
  // that match nothing are NOT filtered out here — a session can be
  // momentarily absent (a window that has not yet read the spool, an
  // editor in the process of resuming it) and find its place again later.
  // Nothing ever sweeps these entries away: a conversation reopened
  // months later comes back to its folder, and an entry weighs a few
  // bytes.
  const sessionOrder: Record<string, readonly string[]> = {};
  const rawOrder = root['sessionOrder'];
  if (isRecord(rawOrder)) {
    for (const [groupId, ids] of Object.entries(rawOrder)) {
      if (!Array.isArray(ids)) continue;
      const clean = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (clean.length > 0) sessionOrder[groupId] = clean;
    }
  }

  // Arranged by event, rather than flat: a flat shape (the one from
  // before sounds were per event) is not converted but ignored — guessing
  // which event to attach a sound to would make the editor chime where
  // the user did not ask for it.
  const sessionSounds: Record<ChimeEvent, Record<string, string>> = { waiting: {}, done: {} };
  const rawSounds = root['sessionSounds'];
  if (isRecord(rawSounds)) {
    for (const event of CHIME_EVENTS) {
      const forEvent = rawSounds[event];
      if (!isRecord(forEvent)) continue;
      for (const [sessionId, sound] of Object.entries(forEvent)) {
        if (typeof sound === 'string' && sound.length > 0) sessionSounds[event][sessionId] = sound;
      }
    }
  }

  const unknown: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(root)) if (!KNOWN.has(k)) unknown[k] = v;

  return { groups, assignments, sessionOrder, sessionSounds, unknown };
}

export function serializeGroups(s: GroupsState): string {
  const body = { ...s.unknown, version: 1, groups: s.groups, assignments: s.assignments, sessionOrder: s.sessionOrder, sessionSounds: s.sessionSounds };
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function createGroup(s: GroupsState, label: string, newId: () => string): GroupsState {
  const clean = name(label);
  if (clean === undefined) throw emptyNameError();
  return { ...s, groups: [...s.groups, { id: newId(), name: clean, order: s.groups.length }] };
}

/**
 * Moves folders in front of another one, and renumbers every `order` from
 * scratch.
 *
 * Renumbered wholesale rather than patched: `order` is only ever read through
 * the sort in `parseGroups`, so what matters is the sequence, not the numbers.
 * Handing back a dense 0…n-1 run keeps two folders from ever sharing a value
 * through our own doing, and makes the result of a move readable in the file.
 *
 * `beforeId === undefined` means "to the end" — a folder dropped past the last
 * one. An unknown `beforeId`, or one of the moved folders itself, is treated
 * the same way rather than refused: the drop already happened as far as the
 * user is concerned, and dropping the request would be a gesture that silently
 * did nothing.
 */
export function reorderGroups(
  s: GroupsState,
  movedIds: readonly string[],
  beforeId: string | undefined,
): GroupsState {
  const moving = new Set(movedIds);
  // Taken from the state, not from `movedIds`: the caller's order is the order
  // VSCode reports a multiple selection in, which is not the one on screen.
  const moved = s.groups.filter((g) => moving.has(g.id));
  if (moved.length === 0) return s;
  const rest = s.groups.filter((g) => !moving.has(g.id));
  const at = beforeId === undefined || moving.has(beforeId) ? -1 : rest.findIndex((g) => g.id === beforeId);
  const cut = at < 0 ? rest.length : at;
  const next = [...rest.slice(0, cut), ...moved, ...rest.slice(cut)];
  return { ...s, groups: next.map((g, order) => ({ ...g, order })) };
}

/**
 * Thrown by both namings. The literal is the key of the translation bundle
 * and the text a test matches on, so it is written once.
 */
function emptyNameError(): Error {
  return new Error(vscode.l10n.t('A folder cannot have an empty name.'));
}

export function renameGroup(s: GroupsState, id: string, label: string): GroupsState {
  const clean = name(label);
  if (clean === undefined) throw emptyNameError();
  return { ...s, groups: s.groups.map((g) => (g.id === id ? { ...g, name: clean } : g)) };
}

/**
 * The sound that applies to a conversation, in the intended priority
 * order: the conversation's own, otherwise its folder's, otherwise the
 * global setting. An empty string at one level does not "fall through"
 * to the next — it is an explicit choice of silence, not an absence of
 * choice.
 */
export function soundFor(
  s: GroupsState,
  sessionId: string,
  event: ChimeEvent,
  fallback: string,
): string {
  const own = s.sessionSounds[event][sessionId];
  if (own !== undefined) return own;
  const groupId = s.assignments[sessionId];
  const group = groupId === undefined ? undefined : s.groups.find((g) => g.id === groupId);
  return group?.[GROUP_SOUND[event]] ?? fallback;
}

/** `undefined` removes the conversation's own sound and returns it to its folder. */
export function setSessionSound(
  s: GroupsState,
  sessionId: string,
  event: ChimeEvent,
  sound: string | undefined,
): GroupsState {
  const { [sessionId]: _dropped, ...rest } = s.sessionSounds[event];
  return {
    ...s,
    sessionSounds: { ...s.sessionSounds, [event]: sound === undefined ? rest : { ...rest, [sessionId]: sound } },
  };
}

/** `undefined` removes the folder's sound and returns it to the global setting. */
export function setGroupSound(
  s: GroupsState,
  id: string,
  event: ChimeEvent,
  sound: string | undefined,
): GroupsState {
  const key = GROUP_SOUND[event];
  return {
    ...s,
    groups: s.groups.map((g) => {
      if (g.id !== id) return g;
      const { [key]: _drop, ...rest } = g;
      return sound === undefined ? rest : { ...rest, [key]: sound };
    }),
  };
}

/**
 * `color === undefined` removes the color instead of ignoring it: « None »
 * is a choice made by the user, not an absence of choice. The property is
 * then removed from the object, so that a colorless folder does not leave
 * a dead key behind in the shared file.
 */
export function setGroupColor(s: GroupsState, id: string, color: string | undefined): GroupsState {
  return {
    ...s,
    groups: s.groups.map((g) => {
      if (g.id !== id) return g;
      const { color: _drop, ...rest } = g;
      return color === undefined ? rest : { ...rest, color };
    }),
  };
}

export function deleteGroup(s: GroupsState, id: string): GroupsState {
  const groups = s.groups.filter((g) => g.id !== id).map((g, i) => ({ ...g, order: i }));
  const assignments: Record<string, string> = {};
  for (const [sessionId, groupId] of Object.entries(s.assignments)) {
    if (groupId !== id) assignments[sessionId] = groupId;
  }
  // The folder's order disappears with it: its sessions go back to
  // « Unfiled », where they pick up the default sort again. Keeping it
  // would make a ghost ordering resurface if a folder ever reused this
  // identifier.
  const { [id]: _dropped, ...sessionOrder } = s.sessionOrder;
  return { ...s, groups, assignments, sessionOrder };
}

export function assign(s: GroupsState, sessionId: string, groupId: string): GroupsState {
  if (!s.groups.some((g) => g.id === groupId)) return s;
  return { ...s, assignments: { ...s.assignments, [sessionId]: groupId } };
}

export function unassign(s: GroupsState, sessionId: string): GroupsState {
  if (s.assignments[sessionId] === undefined) return s;
  const assignments = { ...s.assignments };
  delete assignments[sessionId];
  return { ...s, assignments };
}

export function groupIdOf(s: GroupsState, sessionId: string): string | undefined {
  return s.assignments[sessionId];
}

export function sessionOrderOf(s: GroupsState, groupId: string | undefined): readonly string[] {
  return s.sessionOrder[orderKey(groupId)] ?? [];
}

/**
 * Freezes a folder's order. An empty list removes the entry rather than
 * writing an empty array: « no order chosen » and « an empty order » must
 * remain the same state, otherwise the file would accumulate folders
 * ordered into nothing.
 */
export function setSessionOrder(s: GroupsState, groupId: string | undefined, ids: readonly string[]): GroupsState {
  const key = orderKey(groupId);
  const { [key]: _dropped, ...rest } = s.sessionOrder;
  return { ...s, sessionOrder: ids.length === 0 ? rest : { ...rest, [key]: [...ids] } };
}

/**
 * Where sessions moved within a list land.
 *
 * `before` is the session to drop in front of — the one being hovered
 * over — and `undefined` means « to the end ». The moved ones are removed
 * first: without that, moving a session down within its own folder would
 * place it before itself and nothing would move.
 *
 * The insertion point is computed against the ORIGINAL list, then
 * corrected by the number of moved items that preceded it. Looking it up
 * in the amputated list would have a blind spot: when a session is
 * dropped onto ITSELF, it is no longer found there, and it would be sent
 * to the end — a gesture with no intent would turn into a move.
 */
export function reorder(
  current: readonly string[],
  moved: readonly string[],
  before: string | undefined,
): string[] {
  const movedSet = new Set(moved);
  const rest = current.filter((id) => !movedSet.has(id));
  if (before === undefined) return [...rest, ...moved];
  const target = current.indexOf(before);
  // Target unknown to this folder: to the end, rather than guessing.
  if (target === -1) return [...rest, ...moved];
  const removedBefore = current.slice(0, target).filter((id) => movedSet.has(id)).length;
  const at = target - removedBefore;
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}
