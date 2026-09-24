import { describe, expect, it } from 'vitest';
import { decorationColorOf, decorationUriParts, KOH_SCHEME } from '../src/ui/decorations';

describe('decorationUriParts', () => {
  it('carries the color in the URI, not in state kept on the side', () => {
    expect(decorationUriParts('group', 'g-1', 'charts.green')).toEqual({
      scheme: KOH_SCHEME,
      authority: 'group',
      path: '/g-1',
      query: 'c=charts.green',
    });
  });

  it('distinguishes a folder from a session carrying the same identifier', () => {
    const g = decorationUriParts('group', 'x', 'charts.red');
    const s = decorationUriParts('session', 'x', 'charts.red');
    expect(g.authority).not.toBe(s.authority);
  });

  it('changes when the color changes — that is what triggers a re-request of the decoration', () => {
    expect(decorationUriParts('group', 'g-1', 'charts.red').query).not.toBe(
      decorationUriParts('group', 'g-1', 'charts.blue').query,
    );
  });
});

describe('decorationColorOf', () => {
  it('reads back the color that was set', () => {
    const parts = decorationUriParts('group', 'g-1', 'charts.green');
    expect(decorationColorOf(parts)).toBe('charts.green');
  });

  it('never tints a resource that is not ours', () => {
    // This provider is called for EVERY resource displayed by VSCode: a
    // user's file whose query happened to look like ours must not change color.
    expect(decorationColorOf({ scheme: 'file', query: 'c=charts.red' })).toBeUndefined();
    expect(decorationColorOf({ scheme: 'https', query: 'c=charts.red' })).toBeUndefined();
  });

  it('returns undefined when the color is missing or empty', () => {
    expect(decorationColorOf({ scheme: KOH_SCHEME, query: '' })).toBeUndefined();
    expect(decorationColorOf({ scheme: KOH_SCHEME, query: 'c=' })).toBeUndefined();
    expect(decorationColorOf({ scheme: KOH_SCHEME, query: 'autre=charts.red' })).toBeUndefined();
  });
});
