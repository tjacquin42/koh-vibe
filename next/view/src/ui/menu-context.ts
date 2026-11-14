/**
 * What a row tells VSCode on a right-click (data-vscode-context): its kind
 * (`webviewSection`) and the ids the menu commands need (host menus.ts).
 * The editor's own Cut / Copy / Paste are left out: they mean nothing on a row.
 */
export function menuContext(section: string, fields: Record<string, string | number | boolean | undefined> = {}): string {
  const out: Record<string, string | number | boolean> = { webviewSection: section, preventDefaultContextMenuItems: true };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return JSON.stringify(out);
}
