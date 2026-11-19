/**
 * What a row tells VSCode on a right-click (data-vscode-context): its kind
 * (`webviewSection`) and the ids the menu commands need (host menus.ts).
 * The editor's own Cut / Copy / Paste are left out: they mean nothing on a row.
 */
/**
 * The same, for the whole view (15/11): a right-click anywhere else opens
 * nothing — the editor's Cut / Copy / Paste would copy nothing there.
 */
export const NO_MENU = JSON.stringify({ preventDefaultContextMenuItems: true });

/** In a text field they do mean something: there the editor's own come back. */
export const TEXT_MENU = JSON.stringify({ preventDefaultContextMenuItems: false });

/** Whether the right-click speaks French: Koh-Vibe's language, set by the view as it starts (19/11). */
let french = false;

/**
 * The language the right-click menus speak — Koh-Vibe's, not the editor's:
 * each item is declared in English and in French (host menus.ts
 * `frCommand`), and the row says which to show (`kvnFr`).
 */
export function setMenuLanguage(language: string): void {
  french = language.toLowerCase().startsWith('fr');
}

export function menuContext(section: string, fields: Record<string, string | number | boolean | undefined> = {}): string {
  const out: Record<string, string | number | boolean> = { webviewSection: section, preventDefaultContextMenuItems: true };
  if (french) out['kvnFr'] = true;
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return JSON.stringify(out);
}
