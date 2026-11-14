/**
 * What the view can ask the extension to CHANGE — step 4, the end of read-only.
 *
 * Two kinds of change, and the split is the point:
 *
 * - The shared files (`groups.json`, `settings.json`) are written by the V2
 *   itself, through V1's own store modules. Those were built for several
 *   windows writing at once — re-read right before the rename, three-way
 *   merge, replayed when another window got there first — so the V2 is one
 *   more window, nothing new.
 * - What touches a conversation's state (put to sleep, close, start a
 *   new one) goes through V1's commands until the switch-over: V1 holds
 *   those sessions in memory and would write over anything done behind its
 *   back.
 *
 * Every field is checked here, on the host side, before anything runs: the
 * ids end up in files and in V1's commands, the names in a shared file.
 */

/** V1's folder palette (src/ui/colors.ts), by identifier. */
export const FOLDER_COLOR_IDS = ['blue', 'indigo', 'cyan', 'green', 'lime', 'yellow', 'orange', 'red', 'pink', 'purple'] as const;
export type FolderColor = (typeof FOLDER_COLOR_IDS)[number];

/** The boolean settings shared with V1 (settings/model.ts `AppSettingsToggle`). */
export const SETTING_TOGGLES = ['animate', 'persistent', 'expireTemporary'] as const;
export type SettingToggle = (typeof SETTING_TOGGLES)[number];

/**
 * Handed to V1's commands, which own the conversation's state until the
 * switch-over. V1's « Remove from list » is not offered: dropped in the
 * triage (14/11) — it only hid a row that came back on the next message,
 * and the trash does better for a finished conversation.
 */
export const SESSION_COMMANDS = ['sleep', 'close'] as const;
export type SessionCommand = (typeof SESSION_COMMANDS)[number];

export const MAX_NAME = 80;
/** claude.ai caps nothing we know of; a title longer than this is a paste gone wrong. */
export const MAX_TITLE = 200;
/** claude.ai's slugs, as V1 accepts them (artifacts/model.ts): they end up in a URL. */
const SLUG = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_IDS = 200;

export type Action =
  | { kind: 'folder.create'; name: string }
  | { kind: 'folder.rename'; id: string; name: string }
  /** `null` takes the color away. */
  | { kind: 'folder.color'; id: string; color: FolderColor | null }
  /** The conversations in it stay, out of any folder — V1's rule. */
  | { kind: 'folder.delete'; id: string }
  /**
   * A folder's rules (V1 groups/rules.ts): `add` opens a conversation filed
   * there that writes the new rule, `open` shows the rules file.
   */
  | { kind: 'folder.rules'; id: string; mode: 'add' | 'open' }
  /** Moves folders in front of `before`, or to the end. */
  | { kind: 'folder.move'; ids: string[]; before?: string }
  /**
   * Files conversations in a folder — or out of any with no `folder` — and
   * sets that list's order, in one write: a drop.
   */
  | { kind: 'session.file'; ids: string[]; folder?: string; order: string[] }
  | { kind: 'session.command'; command: SessionCommand; id: string }
  /** A new conversation, filed in `folder` once it shows up (V1 does both). */
  | { kind: 'session.new'; folder?: string }
  | { kind: 'session.copyId'; id: string }
  | { kind: 'setting.toggle'; key: SettingToggle; on: boolean }
  /**
   * 0–100; V1 stores 0–1. The volume is the only sound setting: the two
   * sounds themselves are fixed (Attente, Fin — decided in the triage).
   */
  | { kind: 'setting.volume'; percent: number }
  // ── claude.ai, through V1's own API functions (the cloud has no V1 state to clash with)
  | { kind: 'artifact.rename'; slug: string; title: string }
  | { kind: 'artifact.pin'; slug: string; pinned: boolean }
  /** For good, for everyone who could see it: the view asks first. */
  | { kind: 'artifact.delete'; slug: string }
  /** Files pages under a project of the Artifacts tab — `null` is « Other ». Local file, shared with V1. */
  | { kind: 'artifact.project'; slugs: string[]; project: string | null }
  /** Files a page in a folder of the Sessions tab, or takes it out with no `folder`. */
  | { kind: 'artifact.folder'; slug: string; title: string; folder?: string }
  | { kind: 'artifact.copyLink'; slug: string }
  /** Asks claude.ai again now, rather than at the shared five-minute pace. */
  | { kind: 'cloud.refresh'; what: 'artifacts' | 'routines' }
  /** Acts for real (messages, commits…): the view asks first. */
  | { kind: 'routine.run'; id: string }
  | { kind: 'routine.pause'; id: string; paused: boolean }
  | { kind: 'routine.copyLink'; id: string }
  | { kind: 'routine.open'; id: string }
  | { kind: 'process.copy'; pid: number; what: 'pid' | 'command' }
  /** Read again at the click, then confirmed in a dialog that lists what dies with it. */
  | { kind: 'process.kill'; pid: number };

/**
 * Why an action did not land. `v1-missing`: it goes through V1, which is not
 * there. `cloud`: claude.ai said no, or could not be reached — the output
 * channel says which call and why. `stale`: what the row showed is no longer
 * true (a routine paused or spent meanwhile, a process gone), so nothing was
 * done. `failed`: the write or the command threw. A folder gone in the
 * meantime is not an error: V1's merge drops the change, as it does between
 * two V1 windows.
 */
export const ACTION_ERRORS = ['v1-missing', 'cloud', 'stale', 'failed'] as const;
export type ActionError = (typeof ACTION_ERRORS)[number];

export type ActionResult = { ok: true } | { ok: false; error: ActionError };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Session and folder ids: V1 writes UUIDs, but older files may hold other shapes. Never empty, never a path. */
function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[/\\\0]/.test(v);
}

function ids(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length > MAX_IDS) return undefined;
  const out: string[] = [];
  for (const x of v) {
    if (!isId(x)) return undefined;
    out.push(x);
  }
  return out;
}

/** A name as typed: trimmed, non-empty, bounded. */
function cleanName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const name = v.trim();
  return name.length > 0 && name.length <= MAX_NAME ? name : undefined;
}

function isSlug(v: unknown): v is string {
  return typeof v === 'string' && SLUG.test(v);
}

function slugs(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_IDS) return undefined;
  return v.every(isSlug) ? (v as string[]) : undefined;
}

function isPid(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 1;
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return list.some((x) => x === v);
}

export function parseAction(raw: unknown): Action | undefined {
  if (!isRecord(raw)) return undefined;
  switch (raw['kind']) {
    case 'folder.create': {
      const name = cleanName(raw['name']);
      return name === undefined ? undefined : { kind: 'folder.create', name };
    }
    case 'folder.rename': {
      const name = cleanName(raw['name']);
      return name === undefined || !isId(raw['id']) ? undefined : { kind: 'folder.rename', id: raw['id'], name };
    }
    case 'folder.color': {
      const color = raw['color'];
      if (!isId(raw['id'])) return undefined;
      if (color === null) return { kind: 'folder.color', id: raw['id'], color: null };
      return oneOf(FOLDER_COLOR_IDS, color) ? { kind: 'folder.color', id: raw['id'], color } : undefined;
    }
    case 'folder.delete':
      return isId(raw['id']) ? { kind: 'folder.delete', id: raw['id'] } : undefined;
    case 'folder.rules': {
      const mode = raw['mode'];
      return isId(raw['id']) && (mode === 'add' || mode === 'open') ? { kind: 'folder.rules', id: raw['id'], mode } : undefined;
    }
    case 'folder.move': {
      const moved = ids(raw['ids']);
      const before = raw['before'];
      if (moved === undefined || moved.length === 0) return undefined;
      if (before === undefined) return { kind: 'folder.move', ids: moved };
      return isId(before) ? { kind: 'folder.move', ids: moved, before } : undefined;
    }
    case 'session.file': {
      const moved = ids(raw['ids']);
      const order = ids(raw['order']);
      const folder = raw['folder'];
      if (moved === undefined || moved.length === 0 || order === undefined) return undefined;
      if (folder === undefined) return { kind: 'session.file', ids: moved, order };
      return isId(folder) ? { kind: 'session.file', ids: moved, folder, order } : undefined;
    }
    case 'session.command':
      return oneOf(SESSION_COMMANDS, raw['command']) && isId(raw['id']) ? { kind: 'session.command', command: raw['command'], id: raw['id'] } : undefined;
    case 'session.new': {
      const folder = raw['folder'];
      if (folder === undefined) return { kind: 'session.new' };
      return isId(folder) ? { kind: 'session.new', folder } : undefined;
    }
    case 'session.copyId':
      return isId(raw['id']) ? { kind: 'session.copyId', id: raw['id'] } : undefined;
    case 'setting.toggle':
      return oneOf(SETTING_TOGGLES, raw['key']) && typeof raw['on'] === 'boolean' ? { kind: 'setting.toggle', key: raw['key'], on: raw['on'] } : undefined;
    case 'setting.volume': {
      const p = raw['percent'];
      return typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 100 ? { kind: 'setting.volume', percent: p } : undefined;
    }
    case 'artifact.rename': {
      const title = typeof raw['title'] === 'string' ? raw['title'].trim() : '';
      return isSlug(raw['slug']) && title.length > 0 && title.length <= MAX_TITLE ? { kind: 'artifact.rename', slug: raw['slug'], title } : undefined;
    }
    case 'artifact.pin':
      return isSlug(raw['slug']) && typeof raw['pinned'] === 'boolean' ? { kind: 'artifact.pin', slug: raw['slug'], pinned: raw['pinned'] } : undefined;
    case 'artifact.delete':
      return isSlug(raw['slug']) ? { kind: 'artifact.delete', slug: raw['slug'] } : undefined;
    case 'artifact.project': {
      const list = slugs(raw['slugs']);
      if (list === undefined) return undefined;
      if (raw['project'] === null) return { kind: 'artifact.project', slugs: list, project: null };
      const project = cleanName(raw['project']);
      return project === undefined ? undefined : { kind: 'artifact.project', slugs: list, project };
    }
    case 'artifact.folder': {
      const title = raw['title'];
      const folder = raw['folder'];
      if (!isSlug(raw['slug']) || typeof title !== 'string' || title.length > MAX_TITLE) return undefined;
      if (folder === undefined) return { kind: 'artifact.folder', slug: raw['slug'], title };
      return isId(folder) ? { kind: 'artifact.folder', slug: raw['slug'], title, folder } : undefined;
    }
    case 'artifact.copyLink':
      return isSlug(raw['slug']) ? { kind: 'artifact.copyLink', slug: raw['slug'] } : undefined;
    case 'cloud.refresh': {
      const what = raw['what'];
      return what === 'artifacts' || what === 'routines' ? { kind: 'cloud.refresh', what } : undefined;
    }
    case 'routine.run':
    case 'routine.copyLink':
    case 'routine.open':
      return isSlug(raw['id']) ? { kind: raw['kind'], id: raw['id'] } : undefined;
    case 'routine.pause':
      return isSlug(raw['id']) && typeof raw['paused'] === 'boolean' ? { kind: 'routine.pause', id: raw['id'], paused: raw['paused'] } : undefined;
    case 'process.copy': {
      const what = raw['what'];
      return isPid(raw['pid']) && (what === 'pid' || what === 'command') ? { kind: 'process.copy', pid: raw['pid'], what } : undefined;
    }
    case 'process.kill':
      return isPid(raw['pid']) ? { kind: 'process.kill', pid: raw['pid'] } : undefined;
    default:
      return undefined;
  }
}

export function isActionResult(v: unknown): v is ActionResult {
  if (!isRecord(v)) return false;
  if (v['ok'] === true) return true;
  return v['ok'] === false && oneOf(ACTION_ERRORS, v['error']);
}
