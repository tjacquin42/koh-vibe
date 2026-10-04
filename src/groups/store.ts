import { commitMerged, readRaw, withFileQueue } from '../lib/shared-file';
import { emptyGroups, type Group, type GroupsState, parseGroups, serializeGroups } from './model';

/** An unreadable or missing folder listing counts as "empty": the view has to display no matter what. */
export async function readGroups(file: string): Promise<GroupsState> {
  return toState(await readRaw(file));
}

/**
 * Applies `fn` to the folder listing and writes it. The state is re-read **INSIDE**, never held
 * by the caller across an `await`: another window may have filed something in the meantime, and
 * its work must not be overwritten.
 *
 * Two mechanisms, not one — both carried by lib/shared-file.ts, shared with the closed-conversation
 * history (closed/store.ts):
 * 1. `withFileQueue`: two calls on the same file from THIS process never race against each
 *    other.
 * 2. `commitMerged` always re-reads right before renaming, on every merge round, with no
 *    exception; if the file has changed since the merge (ANOTHER window wrote in the
 *    meantime), the merge is replayed from the new content rather than overwriting that
 *    change — the last round merging and writing the freshest state without re-reading once
 *    more.
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
    // Same rule, same reason as the assignments, and once per event: setting
    // the "done" sound of ONE conversation must not erase either its
    // "waiting" sound, or the one another window has just set on a
    // different one.
    sessionSounds: {
      waiting: mergeAssignments(latest.sessionSounds.waiting, before.sessionSounds.waiting, after.sessionSounds.waiting),
      done: mergeAssignments(latest.sessionSounds.done, before.sessionSounds.done, after.sessionSounds.done),
    },
  };
}

function toState(raw: string | undefined): GroupsState {
  return raw === undefined ? emptyGroups() : parseGroups(raw);
}

/** Order is not part of it: it gets recalculated at the end of the merge. */
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
 * Applies our edit's attributes onto the freshest folder. A removed color
 * removes the key rather than writing `undefined` — same rule as
 * `setGroupColor` (model.ts), so that a round trip through the file does not
 * leave a dead key behind.
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
  // The kept folders come from `latest` — the freshest state, which may hold
  // another window's work — and receive from OUR edit only the attributes it
  // actually changed. Propagating only the name, as this code used to do,
  // silently lost every other attribute: a color that had been set would
  // vanish on write. `sameAttributes` is therefore the list — to be kept up
  // to date — of what a folder carries and a window can modify.
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
 * Merges orders folder by folder, never in bulk: filing into ONE'S OWN
 * folder must not erase the order another window has just set in a
 * DIFFERENT one. Taking `after.sessionOrder` as is, as the first version
 * did, overwrote everything else — the same defect as the color lost by
 * mergeGroups, one field over.
 *
 * An order we did not touch comes back from `latest` (the freshest state);
 * the one we changed is ours; the one we emptied disappears.
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
