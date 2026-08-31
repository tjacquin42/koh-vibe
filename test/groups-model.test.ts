import { describe, expect, it } from 'vitest';
import {
  assign, createGroup, deleteGroup, emptyGroups, groupIdOf, parseGroups,
  renameGroup, reorder, serializeGroups, sessionOrderOf, setGroupColor,
  setGroupSound, setSessionOrder, setSessionSound, soundFor, unassign,
} from '../src/groups/model';
import type { GroupsState } from '../src/groups/model';

describe('parseGroups', () => {
  it('returns an empty state on unreadable data', () => {
    expect(parseGroups('pas du json')).toEqual(emptyGroups());
    expect(parseGroups('null')).toEqual(emptyGroups());
    expect(parseGroups('[]')).toEqual(emptyGroups());
  });

  it('preserves the unknown fields of the file', () => {
    const s = parseGroups(JSON.stringify({ version: 1, groups: [], assignments: {}, futur: { a: 1 } }));
    expect(s.unknown).toEqual({ futur: { a: 1 } });
  });

  it('discards a folder with no id or no name, keeps the others', () => {
    const s = parseGroups(JSON.stringify({
      groups: [{ id: 'g1', name: 'bon', order: 0 }, { id: 'g2' }, { name: 'sans id' }],
      assignments: {},
    }));
    expect(s.groups.map((g) => g.id)).toEqual(['g1']);
  });

  it('discards an assignment that points at no folder', () => {
    const s = parseGroups(JSON.stringify({
      groups: [{ id: 'g1', name: 'bon', order: 0 }],
      assignments: { s1: 'g1', s2: 'disparu' },
    }));
    expect(s.assignments).toEqual({ s1: 'g1' });
  });

  it('deduplicates folders sharing an id, keeping the first', () => {
    const s = parseGroups(JSON.stringify({
      groups: [
        { id: 'g1', name: 'premier', order: 0 },
        { id: 'g1', name: 'second', order: 1 },
      ],
      assignments: {},
    }));
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0]?.name).toBe('premier');
  });

  it('ignores a groups field that is not an array', () => {
    const s = parseGroups(JSON.stringify({ groups: 'pas un tableau', assignments: {} }));
    expect(s.groups).toEqual([]);
  });

  it('ignores an assignments field that is a string', () => {
    const s = parseGroups(JSON.stringify({
      groups: [{ id: 'g1', name: 'bon', order: 0 }],
      assignments: 'pas un objet',
    }));
    expect(s.assignments).toEqual({});
  });

  it('keeps an assignment whose session key is empty', () => {
    const s = parseGroups(JSON.stringify({
      groups: [{ id: 'g1', name: 'bon', order: 0 }],
      assignments: { '': 'g1' },
    }));
    expect(s.assignments).toEqual({ '': 'g1' });
  });
});

describe('createGroup', () => {
  it('appends the folder last', () => {
    const s = createGroup(createGroup(emptyGroups(), 'un', () => 'a'), 'deux', () => 'b');
    expect(s.groups.map((g) => [g.name, g.order])).toEqual([['un', 0], ['deux', 1]]);
  });

  it('refuses a name that is empty or made of spaces', () => {
    expect(() => createGroup(emptyGroups(), '   ', () => 'a')).toThrow();
  });

  it('trims the spaces around the name', () => {
    expect(createGroup(emptyGroups(), '  Boutique  ', () => 'a').groups[0]?.name).toBe('Boutique');
  });

  it('accepts two folders of one name, with distinct ids', () => {
    let n = 0;
    const s = createGroup(createGroup(emptyGroups(), 'même', () => `g${++n}`), 'même', () => `g${++n}`);
    expect(s.groups).toHaveLength(2);
    expect(s.groups[0]?.id).not.toBe(s.groups[1]?.id);
  });
});

describe('assign / unassign', () => {
  const base = createGroup(emptyGroups(), 'dossier', () => 'g1');

  it('assigns a session to a folder', () => {
    expect(groupIdOf(assign(base, 's1', 'g1'), 's1')).toBe('g1');
  });

  it('ignores an assignment to a folder that does not exist', () => {
    expect(groupIdOf(assign(base, 's1', 'fantôme'), 's1')).toBeUndefined();
  });

  it('moving replaces, it does not accumulate', () => {
    const deux = createGroup(base, 'autre', () => 'g2');
    const s = assign(assign(deux, 's1', 'g1'), 's1', 'g2');
    expect(groupIdOf(s, 's1')).toBe('g2');
    expect(Object.keys(s.assignments)).toHaveLength(1);
  });

  it('removing hands the session back to "unfiled"', () => {
    expect(groupIdOf(unassign(assign(base, 's1', 'g1'), 's1'), 's1')).toBeUndefined();
  });
});

describe('deleteGroup', () => {
  it('hands its sessions back to "unfiled" rather than losing them', () => {
    const s = deleteGroup(assign(createGroup(emptyGroups(), 'd', () => 'g1'), 's1', 'g1'), 'g1');
    expect(s.groups).toHaveLength(0);
    expect(s.assignments).toEqual({});
  });

  it('renumbers the remaining folders with no gap', () => {
    let n = 0;
    let s = emptyGroups();
    for (const nom of ['a', 'b', 'c']) s = createGroup(s, nom, () => `g${++n}`);
    expect(deleteGroup(s, 'g2').groups.map((g) => g.order)).toEqual([0, 1]);
  });
});

describe('renameGroup', () => {
  it('renames without touching the assignments', () => {
    const s = renameGroup(assign(createGroup(emptyGroups(), 'vieux', () => 'g1'), 's1', 'g1'), 'g1', 'neuf');
    expect(s.groups[0]?.name).toBe('neuf');
    expect(groupIdOf(s, 's1')).toBe('g1');
  });

  it('refuses an empty name', () => {
    expect(() => renameGroup(createGroup(emptyGroups(), 'x', () => 'g1'), 'g1', ' ')).toThrow();
  });
});

describe('serializeGroups', () => {
  it('an unknown field survives a full round trip untouched', () => {
    const original = parseGroups(JSON.stringify({
      groups: [{ id: 'g1', name: 'dossier', order: 0 }],
      assignments: { s1: 'g1' },
      futur: { a: 1 },
    }));
    expect(parseGroups(serializeGroups(original))).toEqual(original);
  });
});

describe('setGroupColor', () => {
  const state = (): GroupsState =>
    parseGroups(JSON.stringify({ version: 1, groups: [{ id: 'g-1', name: 'Un', order: 0 }], assignments: {} }));

  it('sets the colour on the right folder, and on that one alone', () => {
    const two = parseGroups(
      JSON.stringify({
        version: 1,
        groups: [
          { id: 'g-1', name: 'Un', order: 0 },
          { id: 'g-2', name: 'Deux', order: 1 },
        ],
        assignments: {},
      }),
    );
    const after = setGroupColor(two, 'g-2', 'red');
    expect(after.groups.map((g) => g.color)).toEqual([undefined, 'red']);
  });

  it('replaces a colour already set', () => {
    expect(setGroupColor(setGroupColor(state(), 'g-1', 'blue'), 'g-1', 'green').groups[0]?.color).toBe('green');
  });

  it('removes the key rather than writing an empty colour', () => {
    const cleared = setGroupColor(setGroupColor(state(), 'g-1', 'blue'), 'g-1', undefined);
    expect(cleared.groups[0]).not.toHaveProperty('color');
    expect(JSON.parse(serializeGroups(cleared)).groups[0]).not.toHaveProperty('color');
  });

  it('ignores a folder that does not exist', () => {
    expect(setGroupColor(state(), 'g-inconnu', 'red').groups[0]?.color).toBeUndefined();
  });

  it('round-trips through the file: a written colour reads back', () => {
    const written = serializeGroups(setGroupColor(state(), 'g-1', 'purple'));
    expect(parseGroups(written).groups[0]?.color).toBe('purple');
  });

  it('keeps a colour it does not know — the other editor may be more recent', () => {
    const raw = JSON.stringify({
      version: 1,
      groups: [{ id: 'g-1', name: 'Un', order: 0, color: 'turquoise' }],
      assignments: {},
    });
    expect(parseGroups(raw).groups[0]?.color).toBe('turquoise');
    expect(JSON.parse(serializeGroups(parseGroups(raw))).groups[0].color).toBe('turquoise');
  });
});

describe('reorder', () => {
  it('places the moved ones ahead of the target', () => {
    expect(reorder(['a', 'b', 'c'], ['c'], 'b')).toEqual(['a', 'c', 'b']);
  });

  it('places them last when there is no target', () => {
    expect(reorder(['a', 'b'], ['a'], undefined)).toEqual(['b', 'a']);
  });

  it('moves nothing when a session is dropped on itself', () => {
    expect(reorder(['a', 'b', 'c'], ['b'], 'b')).toEqual(['a', 'b', 'c']);
    expect(reorder(['a', 'b', 'c'], ['a'], 'a')).toEqual(['a', 'b', 'c']);
    expect(reorder(['a', 'b', 'c'], ['c'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('moves a session down its own list correctly', () => {
    // Le cas que le retrait préalable rendrait impossible : sans lui, « a »
    // serait inséré avant lui-même et rien ne bougerait.
    expect(reorder(['a', 'b', 'c'], ['a'], 'c')).toEqual(['b', 'a', 'c']);
  });

  it('takes in a session coming from another folder', () => {
    expect(reorder(['a', 'b'], ['x'], 'b')).toEqual(['a', 'x', 'b']);
  });

  it('keeps the moved ones together and in their order', () => {
    expect(reorder(['a', 'b', 'c', 'd'], ['d', 'a'], 'c')).toEqual(['b', 'd', 'a', 'c']);
  });

  it('places them last when the target is unknown, rather than guessing', () => {
    expect(reorder(['a', 'b'], ['x'], 'inexistante')).toEqual(['a', 'b', 'x']);
  });
});

describe('sessionOrder', () => {
  const state = (): GroupsState => parseGroups(JSON.stringify({ version: 1, groups: [], assignments: {} }));

  it('keeps a folder order apart from the "Unfiled" one', () => {
    let s = setSessionOrder(state(), 'g-1', ['a', 'b']);
    s = setSessionOrder(s, undefined, ['x']);
    expect(sessionOrderOf(s, 'g-1')).toEqual(['a', 'b']);
    expect(sessionOrderOf(s, undefined)).toEqual(['x']);
  });

  it('removes the entry rather than writing an empty list', () => {
    const cleared = setSessionOrder(setSessionOrder(state(), 'g-1', ['a']), 'g-1', []);
    expect(JSON.parse(serializeGroups(cleared)).sessionOrder).toEqual({});
  });

  it('round-trips through the file', () => {
    const written = serializeGroups(setSessionOrder(state(), 'g-1', ['a', 'b']));
    expect(sessionOrderOf(parseGroups(written), 'g-1')).toEqual(['a', 'b']);
  });

  it('ignores a malformed entry without bringing the whole read down', () => {
    const raw = JSON.stringify({
      version: 1,
      groups: [{ id: 'g-1', name: 'Un', order: 0 }],
      assignments: {},
      sessionOrder: { 'g-1': ['a', 42, '', 'b'], 'g-2': 'pas un tableau' },
    });
    const s = parseGroups(raw);
    expect(sessionOrderOf(s, 'g-1')).toEqual(['a', 'b']);
    expect(sessionOrderOf(s, 'g-2')).toEqual([]);
    expect(s.groups).toHaveLength(1);
  });

  it('forgets the order of a deleted folder', () => {
    let s = parseGroups(JSON.stringify({ version: 1, groups: [{ id: 'g-1', name: 'Un', order: 0 }], assignments: {} }));
    s = setSessionOrder(s, 'g-1', ['a', 'b']);
    expect(sessionOrderOf(deleteGroup(s, 'g-1'), 'g-1')).toEqual([]);
  });

});

describe('soundFor — three levels of priority, one setting per event', () => {
  const state = (): GroupsState =>
    parseGroups(
      JSON.stringify({
        version: 1,
        groups: [
          { id: 'g1', name: 'Dossier', order: 0, soundWaiting: 'DossierAttend', soundDone: 'DossierFini' },
        ],
        assignments: { s1: 'g1' },
        sessionSounds: { waiting: { s1: 'ConvAttend' }, done: { s1: 'ConvFini' } },
      }),
    );

  it('the conversation wins over its folder', () => {
    expect(soundFor(state(), 's1', 'waiting', 'Global')).toBe('ConvAttend');
    expect(soundFor(state(), 's1', 'done', 'Global')).toBe('ConvFini');
  });

  it('the folder wins over the global setting', () => {
    const s = setSessionSound(state(), 's1', 'waiting', undefined);
    expect(soundFor(s, 's1', 'waiting', 'Global')).toBe('DossierAttend');
  });

  it('the global setting is the last resort', () => {
    let s = setSessionSound(state(), 's1', 'waiting', undefined);
    s = setGroupSound(s, 'g1', 'waiting', undefined);
    expect(soundFor(s, 's1', 'waiting', 'Global')).toBe('Global');
  });

  it('a session outside any folder falls straight back to the global one', () => {
    expect(soundFor(state(), 'inconnue', 'waiting', 'Global')).toBe('Global');
  });

  it('a deliberate silence does NOT fall through to the level above', () => {
    // « Aucun » est un choix explicite : il doit taire la conversation même si
    // son dossier a un son. Sans ça, on ne pourrait jamais faire taire une seule
    // conversation d un dossier sonore.
    expect(soundFor(setSessionSound(state(), 's1', 'waiting', ''), 's1', 'waiting', 'Global')).toBe('');
    const muet = setGroupSound(setSessionSound(state(), 's1', 'waiting', undefined), 'g1', 'waiting', '');
    expect(soundFor(muet, 's1', 'waiting', 'Global')).toBe('');
  });

  it('setting one event does not touch the other — at neither level', () => {
    // Le défaut que ces réglages par événement viennent corriger : un seul son
    // par niveau, dont on ne savait pas quand il sonnerait. Les poser
    // séparément n a de sens que s ils restent séparés.
    const s = setSessionSound(setGroupSound(state(), 'g1', 'done', 'AutreFini'), 's1', 'done', 'AutreConvFini');
    expect(soundFor(s, 's1', 'waiting', 'Global')).toBe('ConvAttend');
    expect(s.groups[0]?.soundWaiting).toBe('DossierAttend');
  });

  it('round-trips through the file', () => {
    const relu = parseGroups(serializeGroups(state()));
    expect(soundFor(relu, 's1', 'waiting', 'Global')).toBe('ConvAttend');
    expect(soundFor(relu, 's1', 'done', 'Global')).toBe('ConvFini');
    expect(relu.groups[0]?.soundDone).toBe('DossierFini');
  });

  it('ignores a file written before per-event sounds, rather than guessing', () => {
    // Rattacher un ancien son à un événement au hasard ferait carillonner
    // l éditeur là où l utilisateur ne l a pas demandé.
    const ancien = parseGroups(
      JSON.stringify({ version: 1, groups: [], assignments: {}, sessionSounds: { s1: 'Ping' } }),
    );
    expect(ancien.sessionSounds).toEqual({ waiting: {}, done: {} });
  });

});
