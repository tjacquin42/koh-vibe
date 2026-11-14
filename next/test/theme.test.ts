import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapted, ideColors } from '../src/host/ide-theme';
import { parseAction } from '../src/shared/actions';
import { DEFAULT_TUNE, KV_PALETTE, parseTheme, themeFilter, tuneHex } from '../src/shared/theme';

describe('the theme', () => {
  it('reads a whole state or nothing, values clamped', () => {
    const slots = [null, { hue: 400, saturation: -5, brightness: 120.4 }, null, null];
    // A slot kept before the grain existed reads with none.
    expect(parseTheme({ current: DEFAULT_TUNE, slots })).toEqual({ current: DEFAULT_TUNE, slots: [null, { hue: 180, saturation: 0, brightness: 120, grain: 0, textures: [] }, null, null] });
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

  it('filters nothing untouched, and colours as the browser filter does', () => {
    expect(themeFilter(DEFAULT_TUNE)).toBe('none');
    expect(themeFilter({ hue: 30, saturation: 80, brightness: 110, grain: 0, textures: [] })).toBe('hue-rotate(30deg) saturate(80%) brightness(110%)');
    // The grain is no filter: a texture laid over the view (view/src/ui/theme.ts).
    expect(themeFilter({ ...DEFAULT_TUNE, grain: 40 })).toBe('none');
    expect(tuneHex('#ff9e5e', DEFAULT_TUNE)).toBe('#ff9e5e');
    expect(tuneHex('#808080', { hue: 90, saturation: 0, brightness: 50, grain: 0, textures: [] })).toBe('#404040');
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
