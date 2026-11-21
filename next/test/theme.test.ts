import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapted, ideColors } from '../src/host/ide-theme';
import { parseAction } from '../src/shared/actions';
import { DEFAULT_TUNE, GROUND_TOKENS, groundColours, KV_PALETTE, parseTheme, readStoredTheme, sameTune, storedTheme, tuneHex } from '../src/shared/theme';

describe('the theme', () => {
  it('reads a whole state or nothing, values clamped', () => {
    const slots = [null, { hue: 400, saturation: -5, brightness: 120.4 }, null, null];
    // A slot kept before the grain existed reads with none.
    expect(parseTheme({ current: DEFAULT_TUNE, slots })).toEqual({ current: DEFAULT_TUNE, slots: [null, { hue: 180, saturation: 0, brightness: 120, grain: 0, textures: [], ground: 'koh' }, null, null] });
    expect(parseTheme({ current: { ...DEFAULT_TUNE, grain: 140 }, slots: [null, null, null, null] })?.current.grain).toBe(100);
    // A grain kept before textures could be picked reads as the grain texture; unknown ids drop.
    expect(parseTheme({ current: { hue: 0, saturation: 100, brightness: 100, grain: 40 }, slots: [null, null, null, null] })?.current.textures).toEqual(['grain']);
    expect(parseTheme({ current: { ...DEFAULT_TUNE, grain: 40, textures: ['grid', 'paper', 'lines'] }, slots: [null, null, null, null] })?.current.textures).toEqual(['lines', 'grid']);
    expect(parseTheme({ current: DEFAULT_TUNE, slots: [null] })).toBeUndefined();
    expect(parseTheme({ current: { hue: 0 }, slots: [null, null, null, null] })).toBeUndefined();
    expect(parseAction({ kind: 'theme.set', theme: 'red' })).toBeUndefined();
    expect(parseAction({ kind: 'theme.ide', mode: 'adapt' })).toEqual({ kind: 'theme.ide', mode: 'adapt' });
    expect(parseAction({ kind: 'theme.ide', mode: 'paint' })).toBeUndefined();
  });

  it('leaves a colour untouched by the default tuning, and tunes it as the browser filter would', () => {
    expect(tuneHex('#ff9e5e', DEFAULT_TUNE)).toBe('#ff9e5e');
    expect(tuneHex('#808080', { hue: 90, saturation: 0, brightness: 50, grain: 0, textures: [], ground: 'koh' })).toBe('#404040');
  });

  it('starts on the editor’s own background, its colours untouched, on a fresh install (19/11)', () => {
    expect(DEFAULT_TUNE.ground).toBe('ide');
    // Nothing kept yet: nothing to read, and the default applies.
    expect(readStoredTheme(undefined)).toBeUndefined();
  });

  it('reads the background it was kept with, Koh-Vibe’s before there was a choice', () => {
    const slots = [null, null, null, null];
    expect(parseTheme({ current: { ...DEFAULT_TUNE, ground: 'ide' }, slots })?.current.ground).toBe('ide');
    expect(parseTheme({ current: { hue: 0, saturation: 100, brightness: 100 }, slots })?.current.ground).toBe('koh');
    expect(parseTheme({ current: { ...DEFAULT_TUNE, ground: 'paper' }, slots })?.current.ground).toBe('koh');
    expect(sameTune(DEFAULT_TUNE, { ...DEFAULT_TUNE, ground: 'koh' })).toBe(false);
  });

  it('colours the background only — never the text, the accent or the states', () => {
    expect(GROUND_TOKENS).toEqual(['bg', 'surface', 'raised', 'line']);
    const dim = { ...DEFAULT_TUNE, brightness: 60 };
    expect(groundColours(DEFAULT_TUNE)).toEqual({ bg: KV_PALETTE.bg, surface: KV_PALETTE.surface, raised: KV_PALETTE.raised, line: KV_PALETTE.line });
    expect(groundColours(dim).bg).toBe(tuneHex(KV_PALETTE.bg, dim));
    expect(groundColours(dim).bg).not.toBe(KV_PALETTE.bg);
    // What the view paints (lib/theme.ts) sets these tokens and nothing else: no filter left on the page.
    const paint = readFileSync(join(__dirname, '../view/src/lib/theme.ts'), 'utf8');
    expect(paint).not.toContain('style.filter');
  });

  it('doubles once the grain of a theme kept before 50 % became the new 100 %, so it looks the same', () => {
    const old = { current: { ...DEFAULT_TUNE, grain: 50, textures: ['grain'] }, slots: [{ ...DEFAULT_TUNE, grain: 70 }, null, null, null] };
    const read = readStoredTheme(old);
    expect(read?.current.grain).toBe(100);
    expect(read?.slots[0]?.grain).toBe(100);
    // Written back with its scale, it is read as it is from then on.
    const kept = storedTheme(read ?? parseTheme(old)!);
    expect(readStoredTheme(JSON.parse(JSON.stringify(kept)))?.current.grain).toBe(100);
    expect(readStoredTheme('nothing')).toBeUndefined();
  });

  it('keeps its palette in step with the view’s tokens', () => {
    const css = readFileSync(join(__dirname, '../view/src/styles/app.css'), 'utf8');
    const token = (name: string): string | undefined => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(css)?.[1];
    const names: Record<keyof typeof KV_PALETTE, string> = { bg: 'bg', surface: 'surface', raised: 'raised', line: 'line', text: 'text', soft: 'soft', muted: 'muted', accent: 'accent', onAccent: 'on-accent', link: 'link' };
    for (const [k, v] of Object.entries(KV_PALETTE)) expect(token(names[k as keyof typeof KV_PALETTE])).toBe(v);
  });

  it('lays its colours over the user’s own, which stay under', () => {
    const mine = { 'editor.background': '#000000', 'terminal.ansiRed': '#ff0000', '[Monokai]': { 'editor.background': '#111111', 'badge.background': '#222222' } };
    const out = adapted(mine, DEFAULT_TUNE, 'Monokai');
    expect(out['editor.background']).toBe(KV_PALETTE.bg);
    expect(out['terminal.ansiRed']).toBe('#ff0000');
    // The active theme's own block wins over the general keys: ours go in it too, over its own.
    expect(out['[Monokai]']).toEqual({ ...ideColors(DEFAULT_TUNE), 'badge.background': '#222222' });
    expect(adapted(null, DEFAULT_TUNE, undefined)).toEqual(ideColors(DEFAULT_TUNE));
    expect(Object.values(ideColors(DEFAULT_TUNE)).every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });
});
