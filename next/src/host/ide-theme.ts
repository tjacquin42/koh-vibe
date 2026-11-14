/**
 * « Adapt the theme to the IDE » (14/11): the editor around Koh-Vibe takes
 * its colours — tuned as the view is — through the user's
 * `workbench.colorCustomizations`, the one place an extension may set them.
 *
 * What was there before is kept, once, and given back whole by « Back to
 * default »: the editor ends up exactly as it was without Koh-Vibe. Adapting
 * again, with another tuning, starts from that same original, so the user's
 * own customizations stay under ours and come back after.
 */
import { KV_PALETTE, tuneHex, type ThemeTune } from '../shared/theme';

export type ColorMap = Record<string, string>;

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
  value: ColorMap | null;
}

/** The setting to write: the original, with Koh-Vibe's colours over it. */
export function adapted(original: ColorMap | null, t: ThemeTune): ColorMap {
  return { ...(original ?? {}), ...ideColors(t) };
}

/** A setting value read back as a colour map; anything else as nothing. */
export function asColorMap(v: unknown): ColorMap | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as ColorMap;
}
