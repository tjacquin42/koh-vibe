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
  /** 0–100; V1 stores 0–1. */
  | { kind: 'setting.volume'; percent: number }
  /** V1's sound picker, which plays each sound as the selection moves. */
  | { kind: 'setting.sound'; event: 'waiting' | 'done' };

/**
 * Why an action did not land. `v1-missing`: it goes through V1, which is not
 * there. `failed`: the write or the command threw. A folder gone in the
 * meantime is not an error: V1's merge drops the change, as it does between
 * two V1 windows.
 */
export const ACTION_ERRORS = ['v1-missing', 'failed'] as const;
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
    case 'setting.sound': {
      const event = raw['event'];
      return event === 'waiting' || event === 'done' ? { kind: 'setting.sound', event } : undefined;
    }
    default:
      return undefined;
  }
}

export function isActionResult(v: unknown): v is ActionResult {
  if (!isRecord(v)) return false;
  if (v['ok'] === true) return true;
  return v['ok'] === false && oneOf(ACTION_ERRORS, v['error']);
}
