import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TUNE, GRAIN_FULL, groundColours, type ThemeTune } from '../../src/shared/theme';
import { textureLayers } from '../src/lib/textures';

/** The root element, as far as the tuning touches it: a dataset and CSS properties. */
function fakeRoot() {
  const props = new Map<string, string>();
  const dataset: Record<string, string> = {};
  const style = {
    setProperty: (k: string, v: string): void => void props.set(k, v),
    removeProperty: (k: string): void => void props.delete(k),
  };
  return { props, dataset, style };
}

let root = fakeRoot();
type ThemeModule = typeof import('../src/lib/theme');
let theme: ThemeModule;

const tune = (over: Partial<ThemeTune>): ThemeTune => ({ ...DEFAULT_TUNE, ground: 'koh', ...over });

beforeEach(async () => {
  root = fakeRoot();
  vi.stubGlobal('document', { documentElement: root });
  // The module keeps what it is showing: each test starts from a fresh one.
  vi.resetModules();
  theme = await import('../src/lib/theme');
});

describe('the tuning of the background (15/11)', () => {
  it('tells the style sheet which ground is worn, and leaves the tokens alone when the tuning changes nothing', () => {
    theme.showStoredTheme(tune({}));
    expect(root.dataset['ground']).toBe('koh');
    for (const token of ['bg', 'surface', 'raised', 'line']) expect(root.props.has(`--${token}`)).toBe(false);
    expect(root.props.get('--texture')).toBe('none');
    expect(root.props.get('--grain')).toBe('0');
  });

  it('overrides the four ground tokens with Koh-Vibe’s palette, tuned', () => {
    const t = tune({ hue: 90, saturation: 140, brightness: 80 });
    theme.showStoredTheme(t);
    const expected = groundColours(t);
    expect(root.props.get('--bg')).toBe(expected.bg);
    expect(root.props.get('--surface')).toBe(expected.surface);
    expect(root.props.get('--raised')).toBe(expected.raised);
    expect(root.props.get('--line')).toBe(expected.line);
    expect(expected.bg).not.toBe('#14121f');
  });

  it('gives the tokens back to the editor’s theme when its background is worn, whatever the tuning says', () => {
    theme.showStoredTheme(tune({ hue: 90 }));
    expect(root.props.has('--bg')).toBe(true);
    theme.showStoredTheme(tune({ hue: 90, ground: 'ide' }));
    expect(root.dataset['ground']).toBe('ide');
    expect(root.props.has('--bg')).toBe(false);
  });

  it('lays the textures over the page, as strong as the grain says, and none without a texture', () => {
    theme.showStoredTheme(tune({ textures: ['lines', 'dots'], grain: 50 }));
    const layers = textureLayers(['lines', 'dots']);
    expect(root.props.get('--texture')).toBe(layers.image);
    expect(root.props.get('--texture-size')).toBe(layers.size);
    expect(root.props.get('--grain')).toBe(String(0.5 * GRAIN_FULL));
    theme.showStoredTheme(tune({ textures: [], grain: 100 }));
    expect(root.props.get('--grain')).toBe('0');
    expect(root.props.get('--texture')).toBe('none');
  });

  it('shows a preview at once, and goes back to the stored tuning when it ends', () => {
    theme.showStoredTheme(tune({}));
    theme.previewTheme(tune({ hue: 120 }));
    expect(root.props.get('--bg')).toBe(groundColours(tune({ hue: 120 })).bg);
    theme.previewTheme(undefined);
    expect(root.props.has('--bg')).toBe(false);
  });

  it('does not let a snapshot still carrying the old value pull a moving slider back', () => {
    theme.showStoredTheme(tune({}));
    theme.previewTheme(tune({ hue: 120 }));
    theme.showStoredTheme(tune({}));
    expect(root.props.get('--bg')).toBe(groundColours(tune({ hue: 120 })).bg);
  });

  it('ends the preview when the saved tuning arrives, then follows what is stored', () => {
    theme.showStoredTheme(tune({}));
    theme.previewTheme(tune({ hue: 120 }));
    theme.showStoredTheme(tune({ hue: 120 }));
    // Another window changes it: nothing holds the old preview any more.
    theme.showStoredTheme(tune({ hue: -60 }));
    expect(root.props.get('--bg')).toBe(groundColours(tune({ hue: -60 })).bg);
  });

  it('wears the default tuning when nothing is stored', () => {
    theme.showStoredTheme(tune({ hue: 90 }));
    theme.showStoredTheme(undefined);
    expect(root.dataset['ground']).toBe(DEFAULT_TUNE.ground);
    expect(root.props.has('--bg')).toBe(false);
  });
});
