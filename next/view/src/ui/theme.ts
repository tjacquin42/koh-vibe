import { DEFAULT_TUNE, sameTune, themeFilter, type ThemeTune } from '../../../src/shared/theme';

/**
 * The tuning laid over the whole page (shared/theme.ts). On the root element:
 * a filter on any other would become the frame of every `position: fixed`
 * inside it — the popovers would follow it instead of the window.
 *
 * While a slider moves, its value is shown here at once and the snapshots
 * that arrive meanwhile — still the old value — do not pull it back.
 */
let preview: ThemeTune | undefined;
let stored: ThemeTune = DEFAULT_TUNE;

function paint(): void {
  const t = preview ?? stored;
  document.documentElement.style.filter = themeFilter(t);
  // The grain is no filter: a texture over the page (app.css body::after).
  document.documentElement.style.setProperty('--grain', String(t.grain / 100));
}

export function showStoredTheme(t: ThemeTune | undefined): void {
  stored = t ?? DEFAULT_TUNE;
  paint();
}

export function previewTheme(t: ThemeTune | undefined): void {
  preview = t;
  paint();
}

/**
 * How a kept tuning looks on top of the current one, for its swatch: the
 * swatch sits under the page's filter already, so it gets the difference.
 * Hue adds up, saturation and brightness multiply — close enough for a swatch.
 */
export function relativeFilter(slot: ThemeTune, current: ThemeTune): string {
  if (sameTune(slot, current)) return 'none';
  const s = slot.saturation / Math.max(current.saturation, 1);
  const b = slot.brightness / Math.max(current.brightness, 1);
  return `hue-rotate(${slot.hue - current.hue}deg) saturate(${s}) brightness(${b})`;
}
