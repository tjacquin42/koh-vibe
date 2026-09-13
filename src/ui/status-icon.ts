import { join } from 'node:path';
import type { Status } from '../events/types';

/** Subfolder of `resources/` where scripts/make-status-icons.cjs drops the dots. */
export const STATUS_ICON_DIR = 'status';

/**
 * The path to a status's two dots — one per theme family.
 *
 * Why an IMAGE, when a coloured `ThemeIcon` would adapt to every theme,
 * third-party ones included? Because VSCode turns it off the moment the row
 * is selected. The rule lives in its own CSS:
 *
 *   .customview-tree … .monaco-list-row.selected … .custom-view-tree-node-item-icon.codicon
 *     { color: currentColor !important }
 *
 * The `!important` overrides the `ThemeColor` set by the extension: the dot
 * takes on the row's text colour, grey when the view does not have focus —
 * and clicking a session is precisely what gives focus to the editor. The
 * status was therefore disappearing on exactly the row just chosen. No API
 * lets this be bypassed: the selector only targets `.codicon`, and an
 * image icon is not one.
 *
 * The price is accepted: the colours are fixed, in light and in dark,
 * instead of following a third-party theme. A dot that reads clearly but in
 * a slightly different blue beats a dot in the right blue that becomes
 * invisible exactly when it's needed. The values live in
 * scripts/make-status-icons.cjs, which says where each one comes from — and
 * why `waiting` is the only one that does not come from VSCode.
 */
/**
 * The muted dot: an ended conversation, or a tab nobody has woken. Not a
 * status — the row's status is `idle` — but a tone, hence its own name.
 */
export type IconTone = Status | 'ended';

/** Where the motionless twin of every icon lives, beside the moving one. */
export const STILL_ICON_DIR = 'still';

/**
 * The pair of files for a tone, moving or still.
 *
 * `animate === false` swaps in the twin from `still/`, which is the same
 * drawing stopped at the angle its keyframes start from — never another
 * design. Turning motion off must cost nothing in meaning: a dashed ring still
 * says working, a broken one still says waiting.
 */
export function statusIconPath(
  extensionPath: string,
  status: IconTone,
  animate = true,
): { light: string; dark: string } {
  const parts = [extensionPath, 'resources', STATUS_ICON_DIR];
  if (!animate) parts.push(STILL_ICON_DIR);
  const file = (theme: 'light' | 'dark'): string =>
    join(...parts, `${status.replace('_', '-')}-${theme}.svg`);
  return { light: file('light'), dark: file('dark') };
}
