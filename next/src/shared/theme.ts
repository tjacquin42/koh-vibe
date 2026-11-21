/**
 * Koh-Vibe's colours, tuned by the user (14/11): a hue turn, a saturation and
 * a brightness laid over the whole view, and four slots to keep tunings in.
 * Kept by the editor, so the sidebar and the cockpit follow the same one.
 */
export interface ThemeTune {
  /** Degrees, -180 to 180. */
  hue: number;
  /** Percent, 100 untouched. */
  saturation: number;
  /** Percent, 100 untouched. */
  brightness: number;
  /**
   * How strong the textures are, 0 (none) to 100 — Koh-Vibe only: the editor
   * has no texture to take. (Named `grain` since the first texture was one.)
   */
  grain: number;
  /** The textures laid over the view, several at once (view/src/lib/textures.ts). */
  textures: TextureId[];
  /**
   * What the background is (15/11): Koh-Vibe's own, tuned by the three values
   * above, or the editor's — its theme's background, which the tuning leaves
   * alone. Either way only the background: what sits on it keeps its colours.
   */
  ground: Ground;
}

export const GROUNDS = ['koh', 'ide'] as const;
export type Ground = (typeof GROUNDS)[number];

/** Fine patterns on a transparent ground, light and dark strokes alike: they do not change the brightness. */
export const TEXTURES = ['grain', 'lines', 'diagonal', 'dots', 'grid'] as const;
export type TextureId = (typeof TEXTURES)[number];

export interface ThemeState {
  current: ThemeTune;
  /** THEME_SLOTS entries, null where nothing is kept. */
  slots: (ThemeTune | null)[];
}

export const THEME_SLOTS = 4;
export const THEME_RANGE = {
  hue: { min: -180, max: 180 },
  saturation: { min: 0, max: 200 },
  brightness: { min: 50, max: 150 },
  grain: { min: 0, max: 100 },
} as const;

/**
 * A fresh install wears the editor's own background (19/11): Koh-Vibe takes
 * the colours of the editor it lives in, and touches nothing of the code
 * editor's. Koh-Vibe's own night is one click away, in the settings. A theme
 * kept before then keeps its background: one kept with none read as Koh-Vibe's.
 */
export const DEFAULT_TUNE: ThemeTune = { hue: 0, saturation: 100, brightness: 100, grain: 0, textures: [], ground: 'ide' };
export const DEFAULT_THEME: ThemeState = { current: DEFAULT_TUNE, slots: Array.from({ length: THEME_SLOTS }, () => null) };

function num(v: unknown, key: keyof typeof THEME_RANGE): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const { min, max } = THEME_RANGE[key];
  return Math.round(Math.min(max, Math.max(min, v)));
}

/** A tuning from anything: out-of-range values clamped, a missing one refused. */
export function parseTune(raw: unknown): ThemeTune | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const hue = num(r['hue'], 'hue');
  const saturation = num(r['saturation'], 'saturation');
  const brightness = num(r['brightness'], 'brightness');
  // Kept before the grain existed: none.
  const grain = r['grain'] === undefined ? 0 : num(r['grain'], 'grain');
  if (hue === undefined || saturation === undefined || brightness === undefined || grain === undefined) return undefined;
  // Kept before textures could be picked: the grain was the only one.
  const picked = r['textures'];
  const textures: TextureId[] = Array.isArray(picked) ? TEXTURES.filter((id) => picked.includes(id)) : grain > 0 ? ['grain'] : [];
  // Kept before the editor's background could be picked: Koh-Vibe's.
  const ground: Ground = r['ground'] === 'ide' ? 'ide' : 'koh';
  return { hue, saturation, brightness, grain, textures, ground };
}

/** The whole state, or undefined when it cannot be read — never half of it. */
export function parseTheme(raw: unknown): ThemeState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const current = parseTune(r['current']);
  const slots = r['slots'];
  if (current === undefined || !Array.isArray(slots) || slots.length !== THEME_SLOTS) return undefined;
  const parsed = slots.map((s) => (s === null ? null : parseTune(s)));
  if (parsed.some((s) => s === undefined)) return undefined;
  return { current, slots: parsed as (ThemeTune | null)[] };
}

/**
 * How strong the textures show at 100 % (15/11): what 50 % used to give, the
 * old full strength being too much to be of use.
 */
export const GRAIN_FULL = 0.5;

/** The scale a stored theme's grain is written in: 2 since GRAIN_FULL halved it. */
const GRAIN_SCALE = 2;

/**
 * A theme as the editor kept it. One kept before GRAIN_FULL was halved has
 * its grain doubled once, so it looks the same as before — its 50 % is the
 * new 100 %.
 */
export function readStoredTheme(raw: unknown): ThemeState | undefined {
  const state = parseTheme(raw);
  if (state === undefined) return undefined;
  if ((raw as Record<string, unknown>)['grainScale'] === GRAIN_SCALE) return state;
  const rescale = (t: ThemeTune): ThemeTune => ({ ...t, grain: Math.min(THEME_RANGE.grain.max, t.grain * GRAIN_SCALE) });
  return { current: rescale(state.current), slots: state.slots.map((s) => (s === null ? null : rescale(s))) };
}

/** A theme as the editor keeps it: with the scale its grain is written in. */
export function storedTheme(state: ThemeState): ThemeState & { grainScale: number } {
  return { ...state, grainScale: GRAIN_SCALE };
}

export function sameTune(a: ThemeTune, b: ThemeTune): boolean {
  return (
    a.hue === b.hue &&
    a.saturation === b.saturation &&
    a.brightness === b.brightness &&
    a.grain === b.grain &&
    a.textures.join() === b.textures.join() &&
    a.ground === b.ground
  );
}

/** The background tokens the tuning colours — nothing that sits on them (15/11). */
export const GROUND_TOKENS = ['bg', 'surface', 'raised', 'line'] as const;
export type GroundToken = (typeof GROUND_TOKENS)[number];

/** Koh-Vibe's background under a tuning, token by token. */
export function groundColours(t: ThemeTune): Record<GroundToken, string> {
  return { bg: tuneHex(KV_PALETTE.bg, t), surface: tuneHex(KV_PALETTE.surface, t), raised: tuneHex(KV_PALETTE.raised, t), line: tuneHex(KV_PALETTE.line, t) };
}

/**
 * Koh-Vibe's palette — the view's tokens (view/src/styles/app.css :root; a
 * test keeps the two in step), for what has no CSS to filter: the editor's
 * own colours (host/ide-theme.ts).
 */
export const KV_PALETTE = {
  bg: '#14121f',
  surface: '#1d1a2c',
  raised: '#2a2643',
  line: '#352f52',
  text: '#eeeaf8',
  soft: '#c9c3de',
  muted: '#a39cbf',
  accent: '#ff9e5e',
  onAccent: '#1b1020',
  link: '#b9a6ff',
} as const;

type Rgb = [number, number, number];
type Matrix = [Rgb, Rgb, Rgb];

const clamp = (v: number): number => Math.min(1, Math.max(0, v));
const apply = (m: Matrix, c: Rgb): Rgb => m.map((row) => clamp(row[0] * c[0] + row[1] * c[1] + row[2] * c[2])) as Rgb;

/**
 * A colour as the view's filter shows it: hue-rotate, saturate, brightness,
 * in that order, with the Filter Effects matrices, in sRGB as Chromium does.
 */
export function tuneHex(hex: string, t: ThemeTune): string {
  let c: Rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
  const a = (t.hue * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  c = apply(
    [
      [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928],
      [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283],
      [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072],
    ],
    c,
  );
  const s = t.saturation / 100;
  c = apply(
    [
      [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ],
    c,
  );
  const b = t.brightness / 100;
  c = c.map((v) => clamp(v * b)) as Rgb;
  return `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}
