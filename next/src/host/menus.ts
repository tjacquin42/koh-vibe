/**
 * The right-click menus (14/11): VSCode's own context menus, opened over the
 * web view. Each row says what it is through `data-vscode-context`
 * (`webviewSection` plus its ids and a few flags); package.json maps each
 * section to these commands, and VSCode hands the command that context.
 *
 * This list is the one source: package.json's `webview/context` entries, the
 * commands, and their titles are checked against it by a test. The handlers
 * reuse the actions of the view (actions.ts) — what needs a word or a yes
 * (rename, colour, delete, run) asks with the editor's own boxes, which is
 * what a native menu leads one to expect.
 */
import { MAX_NAME, MAX_TITLE, type Action, type ActionResult, type FolderColor } from '../shared/actions';

/** Prefixed: `webviewSection` is shared with every other extension's web views. */
export const SECTIONS = ['kvnSession', 'kvnClosed', 'kvnFolder', 'kvnUnfiled', 'kvnArtifact', 'kvnRoutine', 'kvnProcess'] as const;
export type Section = (typeof SECTIONS)[number];

export interface MenuItem {
  command: string;
  section: Section;
  /** Extra condition on the row's flags, in VSCode's `when` syntax. */
  when?: string;
  /** `group@order`: groups are separated by a line in the menu. */
  group: string;
  en: string;
  fr: string;
}

const c = (name: string): string => `kohVibeNext.ctx.${name}`;

export const MENU_ITEMS: readonly MenuItem[] = [
  { command: c('session.open'), section: 'kvnSession', group: '1_open@1', en: 'Go to the conversation', fr: 'Aller à la conversation' },
  { command: c('session.sheet'), section: 'kvnSession', group: '1_open@2', en: 'Open its sheet', fr: 'Ouvrir sa fiche' },
  { command: c('session.sleep'), section: 'kvnSession', when: '!kvnEnded', group: '2_state@1', en: 'Put to sleep', fr: 'Mettre en veille' },
  { command: c('session.close'), section: 'kvnSession', group: '2_state@2', en: 'Close', fr: 'Fermer' },
  { command: c('session.copyId'), section: 'kvnSession', group: '9_copy@1', en: 'Copy the ID', fr: 'Copier l’ID' },
  { command: c('closed.reopen'), section: 'kvnClosed', when: 'kvnResumable', group: '1_open@1', en: 'Resume', fr: 'Reprendre' },
  { command: c('closed.copyId'), section: 'kvnClosed', group: '9_copy@1', en: 'Copy the ID', fr: 'Copier l’ID' },
  { command: c('folder.newSession'), section: 'kvnFolder', group: '1_new@1', en: 'New conversation here', fr: 'Nouvelle conversation ici' },
  { command: c('unfiled.newSession'), section: 'kvnUnfiled', group: '1_new@1', en: 'New conversation', fr: 'Nouvelle conversation' },
  { command: c('folder.addRule'), section: 'kvnFolder', group: '2_rules@1', en: 'Add a rule', fr: 'Ajouter une règle' },
  { command: c('folder.openRules'), section: 'kvnFolder', group: '2_rules@2', en: 'See the rules', fr: 'Voir les règles' },
  { command: c('folder.rename'), section: 'kvnFolder', group: '3_edit@1', en: 'Rename…', fr: 'Renommer…' },
  { command: c('folder.color'), section: 'kvnFolder', group: '3_edit@2', en: 'Color…', fr: 'Couleur…' },
  { command: c('folder.delete'), section: 'kvnFolder', group: '9_delete@1', en: 'Delete the folder…', fr: 'Supprimer le dossier…' },
  { command: c('artifact.open'), section: 'kvnArtifact', group: '1_open@1', en: 'Open on claude.ai', fr: 'Ouvrir sur claude.ai' },
  { command: c('artifact.pin'), section: 'kvnArtifact', when: '!kvnPinned', group: '2_edit@1', en: 'Pin', fr: 'Épingler' },
  { command: c('artifact.unpin'), section: 'kvnArtifact', when: 'kvnPinned', group: '2_edit@1', en: 'Unpin', fr: 'Désépingler' },
  { command: c('artifact.rename'), section: 'kvnArtifact', group: '2_edit@2', en: 'Rename…', fr: 'Renommer…' },
  { command: c('artifact.copyLink'), section: 'kvnArtifact', group: '8_copy@1', en: 'Copy the link', fr: 'Copier le lien' },
  { command: c('artifact.delete'), section: 'kvnArtifact', group: '9_delete@1', en: 'Delete…', fr: 'Supprimer…' },
  { command: c('routine.run'), section: 'kvnRoutine', when: 'kvnCanRun', group: '1_run@1', en: 'Run now…', fr: 'Lancer maintenant…' },
  { command: c('routine.pause'), section: 'kvnRoutine', when: 'kvnEnabled', group: '1_run@2', en: 'Pause', fr: 'Mettre en pause' },
  { command: c('routine.resume'), section: 'kvnRoutine', when: 'kvnCanResume', group: '1_run@2', en: 'Resume', fr: 'Reprendre' },
  { command: c('routine.open'), section: 'kvnRoutine', group: '2_open@1', en: 'Open on claude.ai', fr: 'Ouvrir sur claude.ai' },
  { command: c('routine.copyLink'), section: 'kvnRoutine', group: '8_copy@1', en: 'Copy the link', fr: 'Copier le lien' },
  { command: c('process.copyCommand'), section: 'kvnProcess', group: '8_copy@1', en: 'Copy the command', fr: 'Copier la commande' },
  { command: c('process.copyPid'), section: 'kvnProcess', group: '8_copy@2', en: 'Copy the pid', fr: 'Copier le pid' },
  { command: c('process.kill'), section: 'kvnProcess', group: '9_kill@1', en: 'Terminate…', fr: 'Terminer…' },
];

/** The `when` clause package.json carries for an item. */
export function whenOf(item: MenuItem): string {
  return item.when === undefined ? `webviewSection == '${item.section}'` : `webviewSection == '${item.section}' && ${item.when}`;
}

/** What a row put in its `data-vscode-context`, checked field by field: it comes from a web page. */
export interface MenuTarget {
  section: Section;
  sessionId?: string;
  folderId?: string;
  name?: string;
  color?: string;
  slug?: string;
  title?: string;
  routineId?: string;
  pid?: number;
}

function str(v: unknown, max = 128): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
}

export function parseTarget(arg: unknown): MenuTarget | undefined {
  if (typeof arg !== 'object' || arg === null) return undefined;
  const r = arg as Record<string, unknown>;
  const section = SECTIONS.find((s) => s === r['webviewSection']);
  if (section === undefined) return undefined;
  const t: MenuTarget = { section };
  const fields: [keyof MenuTarget, string, number][] = [
    ['sessionId', 'kvnSessionId', 128],
    ['folderId', 'kvnFolderId', 128],
    ['name', 'kvnName', MAX_NAME],
    ['color', 'kvnColor', 32],
    ['slug', 'kvnSlug', 128],
    ['title', 'kvnTitle', MAX_TITLE],
    ['routineId', 'kvnRoutineId', 128],
  ];
  for (const [key, field, max] of fields) {
    const v = str(r[field], max);
    if (v !== undefined) (t as unknown as Record<string, unknown>)[key] = v;
  }
  const pid = r['kvnPid'];
  if (typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 1) t.pid = pid;
  return t;
}

export interface MenuDeps {
  act(action: Action): Promise<ActionResult>;
  /** The click on a conversation: V1 brings its tab forward. */
  open(sessionId: string): void;
  sheet(sessionId: string): void;
  reopen(sessionId: string): void;
  openUrl(url: string): void;
  ask(prompt: string, value: string): Thenable<string | undefined>;
  pickColor(current: string | undefined): Thenable<FolderColor | null | undefined>;
  confirm(message: string, yes: string): Thenable<boolean>;
  t(message: string, ...args: (string | number)[]): string;
  /** A refusal from an action, said the way the view would say it. */
  report(result: ActionResult): void;
}

/** Runs a menu command on the row it was opened on. Never throws. */
export async function runMenu(command: string, arg: unknown, deps: MenuDeps): Promise<void> {
  const target = parseTarget(arg);
  if (target === undefined) return;
  const act = async (a: Action): Promise<void> => deps.report(await deps.act(a));
  const name = (fallback: string): string => target.name ?? target.title ?? fallback;
  const { sessionId: sid, folderId: fid, slug, routineId: rid, pid } = target;
  try {
    switch (command.replace('kohVibeNext.ctx.', '')) {
      case 'session.open':
        if (sid !== undefined) deps.open(sid);
        return;
      case 'session.sheet':
        if (sid !== undefined) deps.sheet(sid);
        return;
      case 'session.sleep':
        if (sid !== undefined) await act({ kind: 'session.command', command: 'sleep', id: sid });
        return;
      case 'session.close':
        if (sid !== undefined) await act({ kind: 'session.command', command: 'close', id: sid });
        return;
      case 'session.copyId':
      case 'closed.copyId':
        if (sid !== undefined) await act({ kind: 'session.copyId', id: sid });
        return;
      case 'closed.reopen':
        if (sid !== undefined) deps.reopen(sid);
        return;
      case 'folder.newSession':
        if (fid !== undefined) await act({ kind: 'session.new', folder: fid });
        return;
      case 'unfiled.newSession':
        await act({ kind: 'session.new' });
        return;
      case 'folder.addRule':
      case 'folder.openRules':
        if (fid !== undefined) await act({ kind: 'folder.rules', id: fid, mode: command.endsWith('addRule') ? 'add' : 'open' });
        return;
      case 'folder.rename': {
        if (fid === undefined) return;
        const next = (await deps.ask(deps.t('New folder name'), name('')))?.trim();
        if (next !== undefined && next.length > 0 && next.length <= MAX_NAME && next !== target.name) await act({ kind: 'folder.rename', id: fid, name: next });
        return;
      }
      case 'folder.color': {
        if (fid === undefined) return;
        const color = await deps.pickColor(target.color);
        if (color !== undefined) await act({ kind: 'folder.color', id: fid, color });
        return;
      }
      case 'folder.delete':
        if (fid !== undefined && (await deps.confirm(deps.t('Delete « {0} »? Its conversations stay, out of any folder.', name('')), deps.t('Delete')))) {
          await act({ kind: 'folder.delete', id: fid });
        }
        return;
      case 'artifact.open':
        if (slug !== undefined) deps.openUrl(`https://claude.ai/artifact/${slug}`);
        return;
      case 'artifact.pin':
      case 'artifact.unpin':
        if (slug !== undefined) await act({ kind: 'artifact.pin', slug, pinned: command.endsWith('.pin') });
        return;
      case 'artifact.rename': {
        if (slug === undefined) return;
        const next = (await deps.ask(deps.t('New title'), target.title ?? ''))?.trim();
        if (next !== undefined && next.length > 0 && next.length <= MAX_TITLE && next !== target.title) await act({ kind: 'artifact.rename', slug, title: next });
        return;
      }
      case 'artifact.copyLink':
        if (slug !== undefined) await act({ kind: 'artifact.copyLink', slug });
        return;
      case 'artifact.delete':
        if (
          slug !== undefined &&
          (await deps.confirm(deps.t('Delete « {0} » from claude.ai for good? Everyone it was shared with loses it too.', name(slug)), deps.t('Delete')))
        ) {
          await act({ kind: 'artifact.delete', slug });
        }
        return;
      case 'routine.run':
        if (rid !== undefined && (await deps.confirm(deps.t('Run « {0} » now? It acts for real: messages, commits, whatever its prompt says.', name(rid)), deps.t('Run')))) {
          await act({ kind: 'routine.run', id: rid });
        }
        return;
      case 'routine.pause':
      case 'routine.resume':
        if (rid !== undefined) await act({ kind: 'routine.pause', id: rid, paused: command.endsWith('pause') });
        return;
      case 'routine.open':
        if (rid !== undefined) await act({ kind: 'routine.open', id: rid });
        return;
      case 'routine.copyLink':
        if (rid !== undefined) await act({ kind: 'routine.copyLink', id: rid });
        return;
      case 'process.copyCommand':
      case 'process.copyPid':
        if (pid !== undefined) await act({ kind: 'process.copy', pid, what: command.endsWith('Pid') ? 'pid' : 'command' });
        return;
      case 'process.kill':
        // The action finds it again and asks, with V1's wording (actions.ts).
        if (pid !== undefined) await act({ kind: 'process.kill', pid });
        return;
    }
  } catch {
    deps.report({ ok: false, error: 'failed' });
  }
}

