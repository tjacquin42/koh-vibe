import { describe, expect, it } from 'vitest';
import { colorChoice, GROUP_COLORS, NO_COLOR_LABEL, shownColor, themeColorOf } from '../src/ui/colors';

describe('palette', () => {
  it('exposes only theme colors, never a hardcoded code', () => {
    // Two families registered by VSCode, and nothing else: a « #4FC3D9 »
    // would stay the same under a light theme, a dark one and a third —
    // that is exactly what the palette exists to avoid.
    for (const c of GROUP_COLORS) expect(c.theme).toMatch(/^(charts|terminal\.ansi)/);
    for (const c of GROUP_COLORS) expect(c.theme).not.toMatch(/#/);
  });

  it('does not offer the same color twice under two names', () => {
    // Two entries in the list that would yield the same blue: the choice
    // would look made when nothing would have changed.
    expect(new Set(GROUP_COLORS.map((c) => c.theme)).size).toBe(GROUP_COLORS.length);
  });

  it('keeps the identifiers already written in groups.json', () => {
    // The file is shared and already populated: removing or renaming one of
    // these six would silently make an existing folder lose its color.
    for (const id of ['blue', 'green', 'yellow', 'orange', 'red', 'purple']) {
      expect(GROUP_COLORS.some((c) => c.id === id)).toBe(true);
    }
  });

  it('carries identifiers and labels that are all distinct', () => {
    expect(new Set(GROUP_COLORS.map((c) => c.id)).size).toBe(GROUP_COLORS.length);
    expect(new Set(GROUP_COLORS.map((c) => c.label)).size).toBe(GROUP_COLORS.length);
  });

  it('does not use the « Aucune » label for a real color', () => {
    expect(GROUP_COLORS.some((c) => c.label === NO_COLOR_LABEL)).toBe(false);
  });
});

describe('themeColorOf', () => {
  it('translates a known identifier into a theme color', () => {
    expect(themeColorOf('blue')).toBe('charts.blue');
  });

  it('shows without color what it does not know, rather than breaking the view', () => {
    expect(themeColorOf('turquoise')).toBeUndefined();
    expect(themeColorOf('')).toBeUndefined();
    expect(themeColorOf(undefined)).toBeUndefined();
  });
});

describe('colorChoice', () => {
  it('sets the chosen color', () => {
    expect(colorChoice('Blue')).toEqual({ kind: 'set', color: 'blue' });
  });

  it('removes the color on « Aucune » — that is a choice, not an absence', () => {
    expect(colorChoice(NO_COLOR_LABEL)).toEqual({ kind: 'set', color: undefined });
  });

  it('touches nothing when the list is closed without choosing', () => {
    expect(colorChoice(undefined)).toEqual({ kind: 'cancel' });
  });

  it('cancels rather than erasing in front of an unknown label', () => {
    // The worst possible outcome would be a silent erasure: closing and
    // choosing anything at all must never remove a color by accident.
    expect(colorChoice('Turquoise')).toEqual({ kind: 'cancel' });
    expect(colorChoice('')).toEqual({ kind: 'cancel' });
  });
});

describe('shownColor', () => {
  const group = { id: 'g1', color: 'blue' };

  it('shows the folder color when no preview is running', () => {
    expect(shownColor(group, undefined)).toBe('blue');
  });

  it('shows the preview on the folder it targets', () => {
    expect(shownColor(group, { groupId: 'g1', color: 'red' })).toBe('red');
  });

  it('leaves the OTHER folders alone', () => {
    // Only one folder is being chosen for at a time: seeing the whole view
    // change while browsing the list would say the opposite of what is happening.
    expect(shownColor(group, { groupId: 'g2', color: 'red' })).toBe('blue');
  });

  it('knows how to show « aucune couleur » as a preview, without confusing it with the absence of a preview', () => {
    // The distinction that matters: browsing over « Aucune » must actually
    // decolor the folder for real, otherwise you confirm without having seen the result.
    expect(shownColor(group, { groupId: 'g1', color: undefined })).toBeUndefined();
    expect(shownColor(group, undefined)).toBe('blue');
  });

  it('does not color « Sans dossier », which carries no choice', () => {
    expect(shownColor(undefined, { groupId: 'g1', color: 'red' })).toBeUndefined();
    expect(shownColor(undefined, undefined)).toBeUndefined();
  });
});
