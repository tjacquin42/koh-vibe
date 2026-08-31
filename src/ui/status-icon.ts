import { join } from 'node:path';
import type { Status } from '../events/types';

/** Sous-dossier de `resources/` où scripts/make-status-icons.cjs dépose les pastilles. */
export const STATUS_ICON_DIR = 'status';

/**
 * Le chemin des deux pastilles d'un statut — une par famille de thème.
 *
 * Pourquoi une IMAGE, alors qu'un `ThemeIcon` coloré s'adapterait à tous les
 * thèmes, y compris tiers ? Parce que VSCode l'éteint dès que la ligne est
 * sélectionnée. La règle vit dans son propre CSS :
 *
 *   .customview-tree … .monaco-list-row.selected … .custom-view-tree-node-item-icon.codicon
 *     { color: currentColor !important }
 *
 * Le `!important` écrase la `ThemeColor` posée par l'extension : la pastille
 * prend la couleur du texte de la ligne, grise quand la vue n'a pas le focus —
 * et cliquer une session donne justement le focus à l'éditeur. Le statut
 * disparaissait donc exactement sur la ligne qu'on venait de choisir. Aucune
 * API ne permet de passer outre : le sélecteur ne vise que `.codicon`, et une
 * icône-image n'en est pas une.
 *
 * Le prix est assumé : les couleurs sont figées, en clair et en sombre, au lieu
 * de suivre un thème tiers. Une pastille lisible mais d'un bleu un peu différent
 * vaut mieux qu'une pastille au bon bleu qu'on ne voit plus quand on en a besoin.
 * Les valeurs vivent dans scripts/make-status-icons.cjs, qui dit d'où vient
 * chacune — et pourquoi `waiting` est le seul à ne pas venir de VSCode.
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
