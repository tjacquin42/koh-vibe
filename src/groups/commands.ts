import type { ChimeEvent } from '../sound/model';
import { assign, createGroup, deleteGroup, renameGroup, reorderGroups, setGroupColor, setGroupSound, setSessionOrder, setSessionSound, unassign } from './model';
import type { GroupsState } from './model';
import { updateGroups } from './store';

/**
 * Creates a folder from the name the user typed. `label === undefined`
 * signals an input box that was cancelled (Escape): nothing to do, nothing
 * to write. A name that is empty or made only of blanks is NOT the same
 * case — the user submitted an empty input — and `createGroup`
 * (groups/model.ts) throws in that case, deliberately. It is up to the call
 * site (`runGroupAction`, below) to turn that throw into a displayed
 * message, never an unhandled rejection: see its documentation.
 */
export async function createGroupCommand(
  groupsFilePath: string,
  label: string | undefined,
  newId: () => string,
): Promise<GroupsState | undefined> {
  if (label === undefined) return undefined;
  return updateGroups(groupsFilePath, (s) => createGroup(s, label, newId));
}

/** Same contract as `createGroupCommand`, for a rename. */
export async function renameGroupCommand(
  groupsFilePath: string,
  id: string,
  label: string | undefined,
): Promise<GroupsState | undefined> {
  if (label === undefined) return undefined;
  return updateGroups(groupsFilePath, (s) => renameGroup(s, id, label));
}

/**
 * Deletes a folder. No input to cancel here (no dialog box for this
 * gesture): called only once a valid folder id has already been resolved at
 * the call site (see `groupIdOfNode`, ui/tree.ts).
 */
export async function deleteGroupCommand(groupsFilePath: string, id: string): Promise<GroupsState> {
  return updateGroups(groupsFilePath, (s) => deleteGroup(s, id));
}

/**
 * Sets or removes a folder's color.
 *
 * The contract deliberately differs from `createGroupCommand`: here
 * `color === undefined` is a choice ("no color"), not a cancellation. A
 * picker closed with Escape must therefore be told apart upstream, at the
 * call site, and must never reach this far — otherwise closing the picker
 * would clear the color instead of doing nothing.
 */
export async function colorGroupCommand(
  groupsFilePath: string,
  id: string,
  color: string | undefined,
): Promise<GroupsState> {
  return updateGroups(groupsFilePath, (s) => setGroupColor(s, id, color));
}

/**
 * Sets or removes the sound of a folder, or of a conversation. Same
 * contract as `colorGroupCommand`: `undefined` is a choice — "fall back to
 * the level above" — and not a cancellation, which must be told apart
 * before reaching here.
 */
export async function soundGroupCommand(
  groupsFilePath: string,
  id: string,
  event: ChimeEvent,
  sound: string | undefined,
): Promise<GroupsState> {
  return updateGroups(groupsFilePath, (s) => setGroupSound(s, id, event, sound));
}

export async function soundSessionCommand(
  groupsFilePath: string,
  sessionId: string,
  event: ChimeEvent,
  sound: string | undefined,
): Promise<GroupsState> {
  return updateGroups(groupsFilePath, (s) => setSessionSound(s, sessionId, event, sound));
}

/**
 * The actual wiring of drag-and-drop (see `SessionsTree.onDrop`, injected
 * into the constructor): assigns each dropped session to the targeted
 * folder, or removes it from any folder when the target is "No folder"
 * (`groupId === undefined`). One single call to `updateGroups` for the
 * whole dropped batch — never one per session — so that a multi-item drop
 * lands as a single write, never interleaving with another window between
 * two ids of the same drop.
 */
export async function applyDrop(
  groupsFilePath: string,
  sessionIds: readonly string[],
  groupId: string | undefined,
  order: readonly string[],
): Promise<GroupsState> {
  return updateGroups(groupsFilePath, (s) => {
    const assigned = sessionIds.reduce(
      (acc, id) => (groupId === undefined ? unassign(acc, id) : assign(acc, id, groupId)),
      s,
    );
    // The order is set AFTER the assignments: `assign` refuses a session
    // heading to a folder that vanished in the meantime, and freezing an
    // order that still named it would leave the file contradicting itself.
    return setSessionOrder(assigned, groupId, order);
  });
}

/**
 * Moves folders in front of another one — or to the end when `beforeId` is
 * undefined.
 *
 * One call to `updateGroups` for the whole batch, like `applyDrop`: the moved
 * folders must land in a single write, never one id at a time with another
 * window free to interleave between two of them.
 */
export async function reorderGroupsCommand(
  groupsFilePath: string,
  groupIds: readonly string[],
  beforeId: string | undefined,
): Promise<GroupsState> {
  return updateGroups(groupsFilePath, (s) => reorderGroups(s, groupIds, beforeId));
}

/**
 * Runs a folder command and turns everything it throws into a message
 * displayed by `onError`, never into an unhandled rejection — this is the
 * only place that knows an empty name (among others) has to end up as a
 * message rather than a crash: none of the three commands above knows about
 * `vscode.window.showErrorMessage`, only the wiring point (extension.ts)
 * hooks it up to `onError`.
 */
export async function runGroupAction(
  action: () => Promise<unknown>,
  onError: (message: string) => void,
): Promise<void> {
  try {
    await action();
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Files one conversation in a folder — the "new session here" gesture, once
 * the conversation it opened has shown up. `assign` refuses a folder that
 * vanished in the meantime, like everywhere else.
 */
export async function fileSessionCommand(groupsFilePath: string, sessionId: string, groupId: string): Promise<GroupsState> {
  return updateGroups(groupsFilePath, (s) => assign(s, sessionId, groupId));
}
