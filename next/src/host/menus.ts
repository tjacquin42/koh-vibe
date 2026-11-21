/**
 * What a right-click item does (21/11). The menus are Koh-Vibe's own, drawn
 * by the view (shared/menus.ts); a click comes here as the item's id and the
 * row's context (protocol.ts `menu`). The handlers reuse the actions of the
 * view (actions.ts) — what needs a word or a yes (rename, colour, delete,
 * run) asks with the editor's own boxes.
 */
import { MAX_NAME, MAX_TITLE, type Action, type ActionResult, type FolderColor } from '../shared/actions';
import { SECTIONS, type Section } from '../shared/menus';

/**
 * What a right-click asks next — a name, a yes — in Koh-Vibe's language
 * (19/11), not the editor's: `bundle` is the French host bundle when
 * Koh-Vibe speaks French, `undefined` for English. A string with no
 * translation is said in English, never left empty.
 */
export function hostTranslator(bundle: Readonly<Record<string, string>> | undefined): (message: string, ...args: (string | number)[]) => string {
  return (message, ...args) => (bundle?.[message] ?? message).replace(/\{(\d+)\}/g, (m, i: string) => {
    const v = args[Number(i)];
    return v === undefined ? m : String(v);
  });
}

/** What a row put in its `data-kv-menu`, checked field by field: it comes from a web page. */
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
  /** Where the settings say artifacts open (extension.ts `openArtifact`). */
  openArtifact(slug: string): void;
  ask(prompt: string, value: string): Thenable<string | undefined>;
  pickColor(current: string | undefined): Thenable<FolderColor | null | undefined>;
  confirm(message: string, yes: string): Thenable<boolean>;
  t(message: string, ...args: (string | number)[]): string;
  /** A refusal from an action, said the way the view would say it. */
  report(result: ActionResult): void;
  /** The artifacts a project folder shows right now, by the latest snapshot. */
  projectSlugs(project: string): string[];
}

/** Runs a menu item on the row it was opened on. Never throws. */
export async function runMenu(command: string, arg: unknown, deps: MenuDeps): Promise<void> {
  const target = parseTarget(arg);
  if (target === undefined) return;
  const act = async (a: Action): Promise<void> => deps.report(await deps.act(a));
  const name = (fallback: string): string => target.name ?? target.title ?? fallback;
  const { sessionId: sid, folderId: fid, slug, routineId: rid, pid } = target;
  try {
    switch (command) {
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
      case 'session.unread':
        if (sid !== undefined) await act({ kind: 'session.command', command: 'unread', id: sid });
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
        if (slug !== undefined) deps.openArtifact(slug);
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
      case 'artProject.rename': {
        const from = target.name;
        if (from === undefined) return;
        const next = (await deps.ask(deps.t('New folder name'), from))?.trim();
        if (next !== undefined && next.length > 0 && next.length <= MAX_NAME && next !== from) {
          await act({ kind: 'artifact.renameProject', from, to: next, slugs: deps.projectSlugs(from) });
        }
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

