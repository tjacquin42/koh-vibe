/**
 * Runs what the view asks to change (shared/actions.ts says which goes where).
 *
 * The shared files are written with V1's own functions — the same ones a V1
 * window calls, with the same merge — so a folder renamed here and a session
 * filed in a V1 window a second later both land. Nothing here writes the
 * spool or a session file: what touches a conversation is V1's command.
 */
import {
  applyDrop,
  colorGroupCommand,
  createGroupCommand,
  deleteGroupCommand,
  renameGroupCommand,
  reorderGroupsCommand,
} from '../../../src/groups/commands';
import { writeSettings } from '../../../src/settings/store';
import type { Action, ActionResult, SessionCommand } from '../shared/actions';

/** V1's menu commands on a conversation row (src/extension.ts). */
export const V1_COMMANDS: Record<SessionCommand, string> = {
  sleep: 'kohVibe.sleepSession',
  close: 'kohVibe.closeSession',
};

export interface ActionDeps {
  groupsFile: string;
  settingsFile: string;
  newId(): string;
  hasCommand(command: string): Promise<boolean>;
  run(command: string, ...args: unknown[]): Thenable<unknown>;
  copy(text: string): Thenable<void>;
}

/** The argument V1's tree passes its menu commands; V1 reads only the id (ui/tree.ts `sessionIdOfNode`). */
const sessionNode = (id: string) => ({ kind: 'session', session: { id } });
const groupNode = (id: string) => ({ kind: 'group', group: { id } });

async function viaV1(deps: ActionDeps, command: string, ...args: unknown[]): Promise<ActionResult> {
  if (!(await deps.hasCommand(command))) return { ok: false, error: 'v1-missing' };
  await deps.run(command, ...args);
  return { ok: true };
}

async function apply(a: Action, deps: ActionDeps): Promise<ActionResult> {
  const file = deps.groupsFile;
  switch (a.kind) {
    case 'folder.create':
      await createGroupCommand(file, a.name, deps.newId);
      return { ok: true };
    case 'folder.rename':
      await renameGroupCommand(file, a.id, a.name);
      return { ok: true };
    case 'folder.color':
      await colorGroupCommand(file, a.id, a.color ?? undefined);
      return { ok: true };
    case 'folder.delete':
      await deleteGroupCommand(file, a.id);
      return { ok: true };
    case 'folder.rules':
      return viaV1(deps, a.mode === 'add' ? 'kohVibe.addFolderRule' : 'kohVibe.openFolderRules', groupNode(a.id));
    case 'folder.move':
      await reorderGroupsCommand(file, a.ids, a.before);
      return { ok: true };
    case 'session.file':
      await applyDrop(file, a.ids, a.folder, a.order);
      return { ok: true };
    case 'session.command':
      return viaV1(deps, V1_COMMANDS[a.command], sessionNode(a.id));
    case 'session.new':
      return a.folder === undefined ? viaV1(deps, 'kohVibe.newSession') : viaV1(deps, 'kohVibe.newSessionInGroup', groupNode(a.folder));
    case 'session.copyId':
      await deps.copy(a.id);
      return { ok: true };
    case 'setting.toggle':
      await writeSettings(deps.settingsFile, { [a.key]: a.on });
      return { ok: true };
    case 'setting.volume':
      await writeSettings(deps.settingsFile, { volume: a.percent / 100 });
      return { ok: true };
    case 'setting.sound':
      return viaV1(deps, 'kohVibe.chooseSound', a.event);
  }
}

/** Never throws: a failure is an answer the view shows, not an unhandled rejection. */
export async function runAction(a: Action, deps: ActionDeps): Promise<ActionResult> {
  try {
    return await apply(a, deps);
  } catch {
    return { ok: false, error: 'failed' };
  }
}
