/**
 * « Adapt the theme to the IDE » (14/11): the editor around Koh-Vibe takes
 * its colours — tuned as the view is — through the user's
 * `workbench.colorCustomizations`, the one place an extension may set them.
 *
 * What was there before is kept, once, and given back whole by « Back to
 * default »: the editor ends up exactly as it was without Koh-Vibe. Adapting
 * again, with another tuning, starts from that same original, so the user's
 * own customizations stay under ours and come back after.
 *
 * A block scoped to the active theme (« [Monokai]: {…} ») wins over the
 * general keys, so the colours go in both: general, and in the active
 * theme's block, over what it held.
 */
import { KV_PALETTE, tuneHex, type ThemeTune } from '../shared/theme';

export type ColorMap = Record<string, string>;
/** The whole setting: colours, and per-theme blocks under « [Theme name] » keys. */
export type Customizations = Record<string, string | ColorMap>;

/** The editor's colours for a tuning: backgrounds, borders, text, accents. */
export function ideColors(t: ThemeTune): ColorMap {
  const c = Object.fromEntries(Object.entries(KV_PALETTE).map(([k, v]) => [k, tuneHex(v, t)])) as Record<keyof typeof KV_PALETTE, string>;
  return {
    foreground: c.soft,
    focusBorder: c.accent,
    'editor.background': c.bg,
    'editorGutter.background': c.bg,
    'editorWidget.background': c.surface,
    'editorGroup.border': c.line,
    'editorGroupHeader.tabsBackground': c.bg,
    'tab.activeBackground': c.surface,
    'tab.inactiveBackground': c.bg,
    'tab.activeForeground': c.text,
    'tab.inactiveForeground': c.muted,
    'tab.activeBorderTop': c.accent,
    'tab.border': c.bg,
    'sideBar.background': c.bg,
    'sideBar.border': c.line,
    'sideBarSectionHeader.background': c.surface,
    'activityBar.background': c.bg,
    'activityBar.border': c.line,
    'activityBar.foreground': c.text,
    'activityBar.inactiveForeground': c.muted,
    'activityBarBadge.background': c.accent,
    'activityBarBadge.foreground': c.onAccent,
    'titleBar.activeBackground': c.bg,
    'titleBar.inactiveBackground': c.bg,
    'titleBar.activeForeground': c.soft,
    'titleBar.border': c.line,
    'statusBar.background': c.surface,
    'statusBar.noFolderBackground': c.surface,
    'statusBar.foreground': c.soft,
    'statusBar.border': c.line,
    'panel.background': c.bg,
    'panel.border': c.line,
    'terminal.background': c.bg,
    'list.activeSelectionBackground': c.raised,
    'list.inactiveSelectionBackground': c.surface,
    'list.hoverBackground': c.surface,
    'input.background': c.surface,
    'dropdown.background': c.surface,
    'menu.background': c.surface,
    'button.background': c.accent,
    'button.foreground': c.onAccent,
    'progressBar.background': c.accent,
    'textLink.foreground': c.link,
  };
}

/** What the user had, as kept before the first adaptation: `null` for nothing at all. */
export interface IdeBackup {
  value: Customizations | null;
}

/** The setting to write: the original, with Koh-Vibe's colours over it, in general and for the active theme. */
export function adapted(original: Customizations | null, t: ThemeTune, theme: string | undefined): Customizations {
  const colors = ideColors(t);
  const out: Customizations = { ...(original ?? {}), ...colors };
  if (theme !== undefined && theme !== '') {
    const key = `[${theme}]`;
    const scoped = original?.[key];
    out[key] = { ...(typeof scoped === 'object' ? scoped : {}), ...colors };
  }
  return out;
}

/** A setting value read back as customizations; anything else as nothing. */
export function asCustomizations(v: unknown): Customizations | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Customizations = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'string') out[k] = x;
    else if (typeof x === 'object' && x !== null && !Array.isArray(x)) {
      out[k] = Object.fromEntries(Object.entries(x as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
    }
  }
  return out;
}
