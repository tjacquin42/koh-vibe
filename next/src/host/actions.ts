/**
 * Runs what the view asks to change (shared/actions.ts says which goes where).
 *
 * The shared files are written with V1's own functions — the same ones a V1
 * window calls, with the same merge — so a folder renamed here and a session
 * filed in a V1 window a second later both land. Nothing here writes the
 * spool or a session file: what touches a conversation is V1's command.
 * claude.ai is called through V1's API functions (cloud.ts); there is no V1
 * state to clash with there, only the shared list caches, refreshed after
 * each change.
 */
import type { ThemeState } from '../shared/theme';
import { fileArtifacts } from '../../../src/artifacts/projects';
import { updateArtifactProjects } from '../../../src/artifacts/projects-store';
import { artifactUrl } from '../../../src/artifacts/model';
import {
  applyDrop,
  colorGroupCommand,
  createGroupCommand,
  deleteGroupCommand,
  fileArtifactsCommand,
  renameGroupCommand,
  reorderGroupsCommand,
} from '../../../src/groups/commands';
import { copyableCommand, type SessionProcess } from '../../../src/process/classify';
import { killPlan, type KillPlan } from '../../../src/process/kill';
import { routineUrl } from '../../../src/routines/model';
import { isSpent } from '../../../src/routines/schedule';
import { writeSettings } from '../../../src/settings/store';
import type { Action, ActionResult, EditorTabs, LanguageChoice, SessionCommand } from '../shared/actions';
import type { CloudActions } from './cloud';
import type { Located } from './processes';

/** V1's menu commands on a conversation row (src/extension.ts). */
export const V1_COMMANDS: Record<SessionCommand, string> = {
  sleep: 'kohVibe.sleepSession',
  close: 'kohVibe.closeSession',
};

/** What was copied, for the status bar line that says so. */
export type Copied = 'id' | 'link' | 'pid' | 'command';

export interface ActionDeps {
  groupsFile: string;
  settingsFile: string;
  artifactProjectsFile: string;
  newId(): string;
  hasCommand(command: string): Promise<boolean>;
  run(command: string, ...args: unknown[]): Thenable<unknown>;
  copy(text: string, what: Copied): Thenable<void>;
  open(url: string): void;
  cloud: CloudActions;
  /** The process, read again at the click (processes.ts `locateProcess`). */
  locate(pid: number): Promise<Located | undefined>;
  /** The editor's modal, with V1's wording; true to go ahead. */
  confirmKill(plan: KillPlan): Promise<boolean>;
  kill(targets: readonly SessionProcess[]): number;
  setEditorTabs(mode: EditorTabs): Thenable<void>;
  setLanguage(choice: LanguageChoice): Thenable<void>;
  /** Runs the tidying agent; how many artifacts it moved, or why it did not. */
  tidy(): Promise<ActionResult>;
  setTidyAsk(ask: boolean): Thenable<void>;
  /** Opens the conversation that adds a rule, or the rules file. */
  tidyRules(mode: 'add' | 'open'): Promise<void>;
  /** Keeps the colours where every view reads them. */
  setTheme(theme: ThemeState): Thenable<void>;
  setTabNames(on: boolean): Thenable<void>;
  setTitleLines(lines: 1 | 2): Thenable<void>;
  ideTheme(mode: 'adapt' | 'restore'): Promise<void>;
}

/** The argument V1's tree passes its menu commands; V1 reads only the id (ui/tree.ts `sessionIdOfNode`). */
const sessionNode = (id: string) => ({ kind: 'session', session: { id } });
const groupNode = (id: string) => ({ kind: 'group', group: { id } });

const OK: ActionResult = { ok: true };

async function viaV1(deps: ActionDeps, command: string, ...args: unknown[]): Promise<ActionResult> {
  if (!(await deps.hasCommand(command))) return { ok: false, error: 'v1-missing' };
  await deps.run(command, ...args);
  return OK;
}

/** A claude.ai change, then the list read again — whether it went through or not, the list says the truth. */
async function viaCloud(deps: ActionDeps, what: 'artifacts' | 'routines', call: () => Promise<boolean>): Promise<ActionResult> {
  const ok = await call();
  await deps.cloud.refresh(what, true);
  return ok ? OK : { ok: false, error: 'cloud' };
}

async function apply(a: Action, deps: ActionDeps): Promise<ActionResult> {
  const file = deps.groupsFile;
  switch (a.kind) {
    case 'folder.create':
      await createGroupCommand(file, a.name, deps.newId);
      return OK;
    case 'folder.rename':
      await renameGroupCommand(file, a.id, a.name);
      return OK;
    case 'folder.color':
      await colorGroupCommand(file, a.id, a.color ?? undefined);
      return OK;
    case 'folder.delete':
      await deleteGroupCommand(file, a.id);
      return OK;
    case 'folder.rules':
      return viaV1(deps, a.mode === 'add' ? 'kohVibe.addFolderRule' : 'kohVibe.openFolderRules', groupNode(a.id));
    case 'folder.move':
      await reorderGroupsCommand(file, a.ids, a.before);
      return OK;
    case 'session.file':
      await applyDrop(file, a.ids, a.folder, a.order);
      return OK;
    case 'session.command':
      return viaV1(deps, V1_COMMANDS[a.command], sessionNode(a.id));
    case 'session.new':
      return a.folder === undefined ? viaV1(deps, 'kohVibe.newSession') : viaV1(deps, 'kohVibe.newSessionInGroup', groupNode(a.folder));
    case 'session.copyId':
      await deps.copy(a.id, 'id');
      return OK;
    case 'setting.toggle':
      await writeSettings(deps.settingsFile, { [a.key]: a.on });
      return OK;
    case 'setting.volume':
      await writeSettings(deps.settingsFile, { volume: a.percent / 100 });
      return OK;
    case 'setting.editorTabs':
      await deps.setEditorTabs(a.mode);
      return OK;
    case 'setting.language':
      await deps.setLanguage(a.choice);
      return OK;
    case 'setting.tabNames':
      await deps.setTabNames(a.on);
      return OK;
    case 'setting.titleLines':
      await deps.setTitleLines(a.lines);
      return OK;

    case 'artifact.rename':
      return viaCloud(deps, 'artifacts', () => deps.cloud.renameArtifact(a.slug, a.title));
    case 'artifact.pin':
      return viaCloud(deps, 'artifacts', () => deps.cloud.pinArtifact(a.slug, a.pinned));
    case 'artifact.delete':
      return viaCloud(deps, 'artifacts', () => deps.cloud.deleteArtifact(a.slug));
    case 'artifact.project':
      await updateArtifactProjects(deps.artifactProjectsFile, (s) => fileArtifacts(s, a.slugs, a.project));
      return OK;
    case 'artifact.folder':
      await fileArtifactsCommand(file, [{ slug: a.slug, title: a.title }], a.folder);
      return OK;
    case 'artifact.copyLink':
      await deps.copy(artifactUrl(a.slug), 'link');
      return OK;
    case 'artifact.tidy':
      return deps.tidy();
    case 'tidy.settings':
      await deps.setTidyAsk(a.ask);
      return OK;
    case 'tidy.rules':
      await deps.tidyRules(a.mode);
      return OK;
    case 'theme.set':
      await deps.setTheme(a.theme);
      return OK;
    case 'theme.ide':
      await deps.ideTheme(a.mode);
      return OK;
    case 'cloud.refresh':
      await deps.cloud.refresh(a.what, true);
      return OK;

    case 'routine.run': {
      // The server refuses a paused or spent routine; checked against the
      // freshest list rather than the row, which may be minutes old.
      const r = await deps.cloud.routine(a.id);
      if (r === undefined || !r.enabled || r.fired) return { ok: false, error: 'stale' };
      return viaCloud(deps, 'routines', () => deps.cloud.runRoutine(a.id));
    }
    case 'routine.pause': {
      const r = await deps.cloud.routine(a.id);
      // Resuming a spent one-shot might run it at once, unasked (V1 `isSpent`).
      if (r === undefined || r.enabled !== a.paused || (!a.paused && isSpent(r, Date.now()))) return { ok: false, error: 'stale' };
      return viaCloud(deps, 'routines', () => deps.cloud.setRoutineEnabled(a.id, !a.paused));
    }
    case 'routine.copyLink':
      await deps.copy(routineUrl(a.id), 'link');
      return OK;
    case 'routine.open':
      deps.open(routineUrl(a.id));
      return OK;

    case 'process.copy': {
      const found = await deps.locate(a.pid);
      if (found === undefined) return { ok: false, error: 'stale' };
      if (a.what === 'pid') {
        await deps.copy(String(found.proc.pid), 'pid');
        return OK;
      }
      const command = copyableCommand(found.proc.command);
      if (command.length === 0) return { ok: false, error: 'stale' };
      await deps.copy(command, 'command');
      return OK;
    }
    case 'process.kill': {
      const found = await deps.locate(a.pid);
      if (found === undefined) return { ok: false, error: 'stale' };
      const plan = killPlan(found.among, found.proc);
      // Cancelled in the dialog: nothing to report.
      if (!(await deps.confirmKill(plan))) return OK;
      deps.kill(plan.targets);
      return OK;
    }
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
