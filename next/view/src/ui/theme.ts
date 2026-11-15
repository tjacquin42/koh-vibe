import { DEFAULT_TUNE, GRAIN_FULL, GROUND_TOKENS, groundColours, sameTune, type ThemeTune } from '../../../src/shared/theme';
import { textureLayers } from './textures';

/**
 * The tuning, on the background only (15/11): the four ground tokens are
 * overridden on the root element, tuned from Koh-Vibe's palette — the
 * buttons, the logo and the colours of the states keep theirs. With the
 * editor's background, the tokens come from its theme instead (app.css,
 * `html[data-ground="ide"]`), and the tuning has nothing to colour.
 *
 * While a slider moves, its value is shown here at once and the snapshots
 * that arrive meanwhile — still the old value — do not pull it back.
 */
let preview: ThemeTune | undefined;
let stored: ThemeTune = DEFAULT_TUNE;

function paint(): void {
  const t = preview ?? stored;
  const html = document.documentElement;
  html.dataset['ground'] = t.ground;
  const ground = groundColours(t);
  const untouched = t.ground === 'ide' || (t.hue === 0 && t.saturation === 100 && t.brightness === 100);
  for (const token of GROUND_TOKENS) {
    if (untouched) html.style.removeProperty(`--${token}`);
    else html.style.setProperty(`--${token}`, ground[token]);
  }
  // The textures are no filter: patterns over the page (app.css body::after, ui/textures.ts).
  const layers = textureLayers(t.textures);
  const root = document.documentElement.style;
  root.setProperty('--texture', layers.image);
  root.setProperty('--texture-size', layers.size);
  root.setProperty('--grain', String(t.textures.length === 0 ? 0 : (t.grain / 100) * GRAIN_FULL));
}

export function showStoredTheme(t: ThemeTune | undefined): void {
  stored = t ?? DEFAULT_TUNE;
  // The preview of a change just saved ends when the saved one arrives.
  if (preview !== undefined && sameTune(preview, stored)) preview = undefined;
  paint();
}

export function previewTheme(t: ThemeTune | undefined): void {
  preview = t;
  paint();
}

