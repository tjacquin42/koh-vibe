/**
 * What a row tells the right-click menu (view/src/components/organisms/
 * ContextMenu.tsx), in its `data-kv-menu`: its kind (`webviewSection`) and
 * the ids the items need (shared/menus.ts) — the host checks them again.
 */

/**
 * The editor's own menu, for the whole view (15/11): a right-click anywhere
 * else opens nothing — its Cut / Copy / Paste would copy nothing there.
 */
export const NO_MENU = JSON.stringify({ preventDefaultContextMenuItems: true });

/** In a text field they do mean something: there the editor's own come back. */
export const TEXT_MENU = JSON.stringify({ preventDefaultContextMenuItems: false });

export function menuContext(section: string, fields: Record<string, string | number | boolean | undefined> = {}): string {
  const out: Record<string, string | number | boolean> = { webviewSection: section };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return JSON.stringify(out);
}

/** A row's `data-kv-menu` read back; `undefined` when it is not one. */
export function readMenuContext(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The busy mark a right-click item sets (busy.ts), as the button that does
 * the same: a new conversation asked for in a folder shows up first in none,
 * and the list waits for it in its folder before bringing it into sight.
 */
export function menuBusyKey(item: string, context: Readonly<Record<string, unknown>>): string | undefined {
  const folder = context['kvnFolderId'];
  if ((item === 'folder.newSession' || item === 'folder.addRule') && typeof folder === 'string') return `new:${folder}`;
  if (item === 'unfiled.newSession') return 'new:';
  return undefined;
}
