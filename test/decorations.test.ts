import { describe, expect, it } from 'vitest';
import { decorationColorOf, decorationUriParts, KOH_SCHEME } from '../src/ui/decorations';

describe('decorationUriParts', () => {
  it('carries the colour in the URI, not in state held on the side', () => {
    expect(decorationUriParts('group', 'g-1', 'charts.green')).toEqual({
      scheme: KOH_SCHEME,
      authority: 'group',
      path: '/g-1',
      query: 'c=charts.green',
    });
  });

  it('tells a folder apart from a session carrying the same id', () => {
    const g = decorationUriParts('group', 'x', 'charts.red');
    const s = decorationUriParts('session', 'x', 'charts.red');
    expect(g.authority).not.toBe(s.authority);
  });

  it('changes when the colour changes — which is what makes the decoration be asked for again', () => {
    expect(decorationUriParts('group', 'g-1', 'charts.red').query).not.toBe(
      decorationUriParts('group', 'g-1', 'charts.blue').query,
    );
  });
});

describe('decorationColorOf', () => {
  it('reads back the colour that was set', () => {
    const parts = decorationUriParts('group', 'g-1', 'charts.green');
    expect(decorationColorOf(parts)).toBe('charts.green');
  });

  it('never tints a resource that is not ours', () => {
    // Ce fournisseur est appelé pour CHAQUE ressource affichée par VSCode :
    // un fichier de l utilisateur dont la query ressemblerait à la nôtre ne
    // doit pas changer de couleur.
    expect(decorationColorOf({ scheme: 'file', query: 'c=charts.red' })).toBeUndefined();
    expect(decorationColorOf({ scheme: 'https', query: 'c=charts.red' })).toBeUndefined();
  });

  it('returns undefined when the colour is missing or empty', () => {
    expect(decorationColorOf({ scheme: KOH_SCHEME, query: '' })).toBeUndefined();
    expect(decorationColorOf({ scheme: KOH_SCHEME, query: 'c=' })).toBeUndefined();
    expect(decorationColorOf({ scheme: KOH_SCHEME, query: 'autre=charts.red' })).toBeUndefined();
  });
});
