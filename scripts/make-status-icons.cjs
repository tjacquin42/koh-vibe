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
  running: { dark: ['#59A4F9', 1], light: ['#0063D3', 1], glow: 0.56 },
  waiting: { dark: ['#D18616', 1], light: ['#C4700E', 1], glow: 0.62 },
  done_unseen: { dark: ['#89D185', 1], light: ['#388A34', 1], glow: 0.53 },
  // Full opacity, where the grey used to sit at 0.7 and 0.3. Muting a grey
  // against a near-black row is muting the only thing it had: the colours can
  // afford to be dimmed because their hue still separates them from the
  // background, and grey has no hue to fall back on. It reads as a quiet dot
  // now, rather than as one that failed to render.
  idle: { dark: ['#B0B0B0', 1], light: ['#6B6B6B', 1], glow: 0.22 },
  // Not a status but a tone: an ended conversation, or a tab nobody has woken.
  //
  // Far dimmer than `idle`, and the two must stay far apart — a closed row and
  // a quiet one are not the same thing, and the dot is what says so at a
  // glance. Dimmer means DARKER on a dark theme and LIGHTER on a light one:
  // what matters is distance from the foreground, not the hex going down.
  //
  // Full opacity all the same, like `idle`. The dimming is carried by the
  // colour itself rather than by an alpha channel, so the dot never reads as
  // one that failed to render — the defect a 0.3 alpha produced.
  ended: { dark: ['#5A5A5A', 1], light: ['#B6B6B6', 1], glow: 0.1 },
};

/**
 * How far each status glows — information, not decoration.
 *
 * The halo says what a row is asking of you, so it is strongest where the
 * conversation is stuck waiting for an answer, and quietest where nothing is
 * running. Past a certain point the strength is no longer carried by the
 * opacity, which caps at 1, but by WHERE the falloff begins — see `halo()`.
 *
 * Light themes hold it back, but far less than they first did. The colours
 * used there are dark and saturated, so a strong halo reads as a coloured
 * aura rather than as a smudge; cut too far, it simply vanished against
 * white, which is the defect this value exists to answer.
 */
const LIGHT_GLOW = 0.75;

// 16 px est la taille à laquelle VSCode affiche l'icône d'une ligne d'arbre
// (`background-size: 16px`), et 4.5 le rayon qui redonne au disque l'encombrement
// du codicon `circle-filled` qu'il remplace — une pastille plus grosse décalerait
// l'œil d'une ligne à l'autre pendant la transition.
/** The subfolder holding the motionless twin of every icon. */
const STILL_DIR = 'still';
const SIZE = 16;
const RADIUS = 4.5;
// The core of a glowing dot, pulled in so the halo has somewhere to be.
const CORE_RADIUS = 3.2;

/**
 * The halo, as a radial gradient filling the whole box.
 *
 * The two stops are where the intensity really lives. Opacity caps at 1, so
 * past that the only way to glow harder is to push the falloff outward: the
 * first stop sits at 30% rather than 18%, which widens the bright core of
 * the glow instead of merely darkening its centre.
 *
 * The id is fixed rather than generated: each file is a standalone document
 * loaded by VSCode as an image (`TreeItem.iconPath`), never inlined into the
 * page, so two dots on screen cannot collide over it.
 */
function halo(fill, strength) {
  if (strength <= 0) return '';
  return (
    `<defs><radialGradient id="g">` +
    `<stop offset="30%" stop-color="${fill}" stop-opacity="${strength.toFixed(3)}"/>` +
    `<stop offset="62%" stop-color="${fill}" stop-opacity="${(strength * 0.45).toFixed(3)}"/>` +
    `<stop offset="100%" stop-color="${fill}" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="url(#g)"/>`
  );
}

/**
 * The ring around the dot, and what it says.
 *
 * One shape, three readings, carried by the dash pattern. `running` is a
 * dashed ring turning steadily — the universal reading of work in progress.
 * `waiting` is a ring with one frank gap, sweeping rather than gliding: what
 * the ring is missing to close is your answer. `done_unseen` is closed, and
 * still: nothing is happening any more, and motion would say otherwise.
 *
 * The greys carry no ring at all. Nothing is running behind them, so there is
 * no cycle to draw.
 */
const RING_RADIUS = 6.2;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RINGS = {
  running: { dash: [CIRCUMFERENCE / 8, CIRCUMFERENCE / 16], width: 1.3, spin: '4.2s linear' },
  waiting: {
    dash: [CIRCUMFERENCE * 0.76, CIRCUMFERENCE * 0.24],
    width: 1.4,
    spin: '3.1s cubic-bezier(.5,0,.5,1)',
  },
  done_unseen: { dash: undefined, width: 1.3, spin: undefined },
};

/**
 * The rotation, in CSS inside the file.
 *
 * Two details are what make it turn ON ITSELF rather than drift around the
 * box, and both were learnt the hard way:
 *
 * The starting angle lives in the KEYFRAMES, never in a `transform` attribute
 * on the element. An attribute transform and a CSS transform animation both
 * feed the same property: the browser then interpolates between two matrices,
 * one of which carries the translation that `rotate(a x y)` decomposes into,
 * and the ring wanders off centre as it turns.
 *
 * And `transform-box: view-box` is stated rather than assumed, so 8px 8px
 * means the centre of the 16-unit viewBox and not the corner of the stroke's
 * own bounding box.
 *
 * `prefers-reduced-motion` stops it: a viewer who asked their system for less
 * movement gets a still ring, which still says everything the dashes say.
 */
function spinStyle(spin) {
  return (
    `<style>` +
    `@keyframes s{from{transform:rotate(-90deg)}to{transform:rotate(270deg)}}` +
    `.r{transform-box:view-box;transform-origin:8px 8px;animation:s ${spin} infinite}` +
    `@media(prefers-reduced-motion:reduce){.r{animation:none;transform:rotate(-90deg)}}` +
    `</style>`
  );
}

function ring(fill, spec, moving) {
  if (spec === undefined) return '';
  const dash = spec.dash === undefined ? '' : ` stroke-dasharray="${spec.dash.map((d) => d.toFixed(2)).join(' ')}"`;
  const turns = moving && spec.spin !== undefined;
  // A ring that does not turn keeps its start angle in an attribute, which is
  // free of the interpolation problem above precisely because nothing animates
  // it — and it is the SAME angle the keyframes start from, so the still set is
  // the moving one stopped, not a second drawing.
  const still = turns ? '' : ' transform="rotate(-90 8 8)"';
  return (
    (turns ? spinStyle(spec.spin) : '') +
    `<circle${turns ? ' class="r"' : ''} cx="8" cy="8" r="${RING_RADIUS}" fill="none" ` +
    `stroke="${fill}" stroke-width="${spec.width}" stroke-linecap="round" stroke-opacity="0.85"${dash}${still}/>`
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
function disc([fill, opacity], glow, spec, moving) {
  const alpha = opacity === 1 ? '' : ` fill-opacity="${opacity}"`;
  // Three objects in 16 px: the core pulls in again once a ring surrounds it,
  // so each keeps some air around it.
  const radius = spec !== undefined ? 2.7 : glow > 0 ? CORE_RADIUS : RADIUS;
  const around = ring(fill, spec, moving);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    halo(fill, glow) +
    around +
    `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${radius}" fill="${fill}"${alpha}/>` +
    `</svg>\n`
  );
}

/**
 * Two sets, from one table.
 *
 * `resources/status/` turns; `resources/status/still/` does not. The extension
 * picks between them from the `animate` setting (ui/status-icon.ts), which is
 * why they must be the same drawing and not two designs: turning motion off
 * has to cost nothing in meaning. The still ring sits at the angle the
 * keyframes start from, so it is literally the moving one stopped.
 */
const dir = join(__dirname, '..', 'resources', 'status');
const stillDir = join(dir, STILL_DIR);
mkdirSync(dir, { recursive: true });
mkdirSync(stillDir, { recursive: true });

for (const [status, themes] of Object.entries(PALETTE)) {
  for (const [theme, color] of Object.entries(themes).filter(([k]) => k === 'dark' || k === 'light')) {
    // Le nom doit rester celui que calcule statusIconPath() : le statut avec ses
    // tirets bas changés en tirets, puis le thème. Un test vérifie que chaque
    // chemin annoncé existe pour de vrai.
    const glow = themes.glow * (theme === 'light' ? LIGHT_GLOW : 1);
    const name = `${status.replace('_', '-')}-${theme}.svg`;
    writeFileSync(join(dir, name), disc(color, glow, RINGS[status], true), 'utf8');
    writeFileSync(join(stillDir, name), disc(color, glow, RINGS[status], false), 'utf8');
    console.log(`écrit ${name} (animé et figé)`);
  }
}
