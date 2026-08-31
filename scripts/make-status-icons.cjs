#!/usr/bin/env node
/**
 * Fabrique les pastilles de statut de la barre latérale — un SVG par statut et
 * par famille de thème.
 *
 * Pourquoi des fichiers plutôt qu'un codicon coloré : voir src/ui/status-icon.ts.
 * En deux mots, VSCode force `color: currentColor !important` sur l'icône d'une
 * ligne SÉLECTIONNÉE, mais seulement quand c'est un codicon. Une image y échappe.
 *
 * Pourquoi un générateur plutôt que dix fichiers écrits à la main : la table
 * ci-dessous est la source. Corriger une teinte, ou ajouter un statut, veut dire
 * toucher une ligne — pas relire dix SVG pour vérifier qu'ils ont bien le même
 * cercle. Même principe que scripts/make-icons.cjs.
 *
 * Usage : node scripts/make-status-icons.cjs
 */
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Les valeurs par DÉFAUT des couleurs de VSCode que portait chaque statut du
 * temps des `ThemeIcon` — relevées dans son registre plutôt que choisies ici,
 * pour que le passage à l'image ne change pas l'apparence hors sélection.
 *
 *   running     charts.blue    → editorInfo.foreground
 *   done_unseen charts.green
 *   idle        descriptionForeground   (le thème sombre l'obtient à 70 % du texte)
 *   stale       disabledForeground      (…et celui-ci à 50 %, d'où l'opacité)
 *
 * Une seule exception, assumée : `waiting` était `charts.yellow`, un or foncé
 * (#CCA700) qui se lit mal comme une alerte — or c'est le seul statut qui
 * demande quelque chose à l'utilisateur, et le seul qui ne se résoudra pas tout
 * seul. Il passe donc à l'orange. Surtout pas `charts.orange`, qui vaut
 * `#EA5C0055` : une couleur de FOND de surlignage, à 33 % d'opacité, délavée en
 * pastille pleine. Les deux valeurs ci-dessous sont des oranges opaques, tenus
 * au-dessus de 3:1 sur leur fond respectif — le seuil WCAG d'un élément
 * graphique porteur de sens.
 *
 * L'opacité est portée par le SVG parce qu'elle fait partie de la couleur :
 * `#CCCCCC80` est un canal alpha dans le registre de VSCode, pas une nuance de gris.
 */
const PALETTE = {
  running: { dark: ['#59A4F9', 1], light: ['#0063D3', 1], glow: 0.75 },
  waiting: { dark: ['#D18616', 1], light: ['#C4700E', 1], glow: 0.95 },
  done_unseen: { dark: ['#89D185', 1], light: ['#388A34', 1], glow: 0.7 },
  idle: { dark: ['#CCCCCC', 0.7], light: ['#717171', 1], glow: 0.18 },
  stale: { dark: ['#CCCCCC', 0.5], light: ['#616161', 0.5], glow: 0 },
  // Not a status but a tone: an ended conversation, or a tab nobody has
  // woken. Dimmer than `stale`, which still describes a live process.
  ended: { dark: ['#CCCCCC', 0.3], light: ['#616161', 0.3], glow: 0 },
};

/**
 * How far each status glows — information, not decoration.
 *
 * The halo says what a row is asking of you, so it is strongest where the
 * conversation is stuck waiting for an answer, and absent where nothing will
 * come. `stale` and `ended` are the two that glow not at all, for the same
 * reason read from opposite ends: a stale row claims to be running but has
 * gone silent (5 minutes, or 30 with a tool in flight — store/staleness.ts),
 * and an ended one is over. Neither is going to produce anything, and a halo
 * on either would promise otherwise.
 *
 * Light themes divide it: on a white row the same value stops reading as
 * light and starts reading as a smudge.
 */
const LIGHT_GLOW = 0.38;

// 16 px est la taille à laquelle VSCode affiche l'icône d'une ligne d'arbre
// (`background-size: 16px`), et 4.5 le rayon qui redonne au disque l'encombrement
// du codicon `circle-filled` qu'il remplace — une pastille plus grosse décalerait
// l'œil d'une ligne à l'autre pendant la transition.
const SIZE = 16;
const RADIUS = 4.5;
// The core of a glowing dot, pulled in so the halo has somewhere to be.
const CORE_RADIUS = 3.2;

/**
 * The halo, as a radial gradient filling the whole box.
 *
 * The id is fixed rather than generated: each file is a standalone document
 * loaded by VSCode as an image (`TreeItem.iconPath`), never inlined into the
 * page, so two dots on screen cannot collide over it.
 */
function halo(fill, strength) {
  if (strength <= 0) return '';
  return (
    `<defs><radialGradient id="g">` +
    `<stop offset="18%" stop-color="${fill}" stop-opacity="${strength.toFixed(3)}"/>` +
    `<stop offset="52%" stop-color="${fill}" stop-opacity="${(strength * 0.34).toFixed(3)}"/>` +
    `<stop offset="100%" stop-color="${fill}" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="url(#g)"/>`
  );
}

/**
 * The dot itself, over its halo.
 *
 * The core shrinks from 4.5 to CORE_RADIUS to make that halo room. The box does
 * not grow — 16 px is what VSCode gives a tree row icon — so a glow is never
 * added AROUND the disc, it is taken out of it. A status that does not glow
 * keeps the full 4.5 and looks exactly as it always did.
 */
function disc([fill, opacity], glow) {
  const alpha = opacity === 1 ? '' : ` fill-opacity="${opacity}"`;
  const radius = glow > 0 ? CORE_RADIUS : RADIUS;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    halo(fill, glow) +
    `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${radius}" fill="${fill}"${alpha}/>` +
    `</svg>\n`
  );
}

const dir = join(__dirname, '..', 'resources', 'status');
mkdirSync(dir, { recursive: true });

for (const [status, themes] of Object.entries(PALETTE)) {
  for (const [theme, color] of Object.entries(themes).filter(([k]) => k === 'dark' || k === 'light')) {
    // Le nom doit rester celui que calcule statusIconPath() : le statut avec ses
    // tirets bas changés en tirets, puis le thème. Un test vérifie que chaque
    // chemin annoncé existe pour de vrai.
    const file = join(dir, `${status.replace('_', '-')}-${theme}.svg`);
    writeFileSync(file, disc(color, themes.glow * (theme === 'light' ? LIGHT_GLOW : 1)), 'utf8');
    console.log(`écrit ${file.slice(file.indexOf('resources'))}`);
  }
}
