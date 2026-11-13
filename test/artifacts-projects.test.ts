import { describe, expect, it } from 'vitest';
import type { Artifact } from '../src/artifacts/model';
import {
  emptyArtifactProjects,
  fileArtifacts,
  fileIfUnfiled,
  groupByProject,
  knownProjects,
  parseArtifactProjects,
  projectKey,
  projectOfArtifact,
  projectForName,
  renameFolder,
  renameProject,
  serializeArtifactProjects,
  titleProject,
  type ArtifactProjects,
} from '../src/artifacts/projects';

const artifact = (slug: string, over: Partial<Artifact> = {}): Artifact => ({ slug, title: slug, pinned: false, ...over });

const filed = (entries: Record<string, string | null>, aliases: Record<string, string | null> = {}): ArtifactProjects => ({
  filed: entries,
  aliases,
  unknown: {},
});

describe('parseArtifactProjects', () => {
  it('reads an unreadable or missing listing as nothing filed', () => {
    for (const raw of ['', 'not json', '[]', 'null', '{"filed": 3}']) {
      expect(parseArtifactProjects(raw).filed).toEqual({});
    }
  });

  it('keeps a project name, trimmed, and Other chosen as null — nothing else', () => {
    const s = parseArtifactProjects(
      JSON.stringify({ version: 1, filed: { a: ' koh-vibe ', b: null, c: '', d: '   ', e: 4, f: {}, g: 'NTI' } }),
    );
    expect(s.filed).toEqual({ a: 'koh-vibe', b: null, g: 'NTI' });
  });

  it('keeps the old names of renamed projects, under their folded form only', () => {
    const s = parseArtifactProjects(
      JSON.stringify({ filed: {}, aliases: { 'project pipeline': 'PP', gone: null, 'Not Folded': 'X', __proto__: 'Y', empty: '' } }),
    );
    expect(s.aliases).toEqual({ 'project pipeline': 'PP', gone: null });
    expect(parseArtifactProjects(serializeArtifactProjects(s)).aliases).toEqual(s.aliases);
  });

  it('keeps the fields it does not know through a round trip', () => {
    const raw = JSON.stringify({ version: 1, filed: { a: 'NTI' }, later: { kept: true } });
    const again = parseArtifactProjects(serializeArtifactProjects(parseArtifactProjects(raw)));
    expect(again.filed).toEqual({ a: 'NTI' });
    expect(again.unknown).toEqual({ later: { kept: true } });
  });
});

describe('projectKey', () => {
  it('reads two spellings of one name as one project', () => {
    expect(projectKey('Koh-Vibe')).toBe(projectKey('koh-vibe'));
    expect(projectKey('koh_vibe')).toBe(projectKey('koh vibe'));
    expect(projectKey('Vétibble')).toBe(projectKey('vetibble'));
    expect(projectKey('  Project   Pipeline ')).toBe(projectKey('project-pipeline'));
    expect(projectKey('NTI')).not.toBe(projectKey('NTIS'));
  });
});

describe('fileArtifacts', () => {
  it('files every artifact given into the project, or into Other with null', () => {
    const s = fileArtifacts(fileArtifacts(emptyArtifactProjects(), ['a', 'b'], 'koh-vibe'), ['c'], null);
    expect(s.filed).toEqual({ a: 'koh-vibe', b: 'koh-vibe', c: null });
  });

  it('files into the project already there when the name differs only in spelling', () => {
    const s = fileArtifacts(filed({ a: 'NTI' }), ['b'], ' nti ');
    expect(s.filed).toEqual({ a: 'NTI', b: 'NTI' });
  });

  it('moves an artifact already filed elsewhere', () => {
    expect(fileArtifacts(filed({ a: 'NTI' }), ['a'], 'Vetibble').filed).toEqual({ a: 'Vetibble' });
  });
});

describe('fileIfUnfiled', () => {
  it('files an artifact that was never filed, in the spelling already in use', () => {
    expect(fileIfUnfiled(filed({ a: 'koh-vibe' }), 'b', 'Koh-Vibe').filed).toEqual({ a: 'koh-vibe', b: 'koh-vibe' });
  });

  it('never moves an artifact that was filed — not even one filed into Other', () => {
    const s = filed({ a: 'NTI', b: null });
    expect(fileIfUnfiled(s, 'a', 'koh-vibe')).toBe(s);
    expect(fileIfUnfiled(s, 'b', 'koh-vibe')).toBe(s);
  });
});

describe('renameProject', () => {
  it('renames the project for every artifact in it, and only those', () => {
    const s = renameProject(filed({ a: 'nti', b: 'nti', c: 'Vetibble', d: null }), 'nti', 'New Test Intelligence');
    expect(s.filed).toEqual({ a: 'New Test Intelligence', b: 'New Test Intelligence', c: 'Vetibble', d: null });
  });

  it('changes the spelling alone when that is all that changes', () => {
    expect(renameProject(filed({ a: 'nti' }), 'nti', 'NTI').filed).toEqual({ a: 'NTI' });
  });

  it('merges into a project that already has that name', () => {
    expect(renameProject(filed({ a: 'PP', b: 'project-pipeline' }), 'PP', 'Project Pipeline').filed).toEqual({
      a: 'project-pipeline',
      b: 'project-pipeline',
    });
  });

  it('empties the project into Other when renamed to null', () => {
    expect(renameProject(filed({ a: 'old', b: 'kept' }), 'old', null).filed).toEqual({ a: null, b: 'kept' });
  });

  it('remembers the old name, so that what still goes by it finds the new one', () => {
    const once = renameProject(filed({ a: 'project-pipeline' }), 'project-pipeline', 'PP');
    expect(once.aliases).toEqual({ 'project pipeline': 'PP' });
    // Renamed again: every old name follows, none is left pointing at a name gone.
    const twice = renameProject(once, 'PP', 'Pipeline');
    expect(twice.aliases).toEqual({ 'project pipeline': 'Pipeline', pp: 'Pipeline' });
    // Back to a name it once had: that name is the project's own again, no alias.
    expect(renameProject(twice, 'Pipeline', 'project-pipeline').aliases).toEqual({ pipeline: 'project-pipeline', pp: 'project-pipeline' });
  });

  it('needs no alias for a change of spelling alone', () => {
    expect(renameProject(filed({ a: 'nti' }), 'nti', 'NTI').aliases).toEqual({});
  });
});

describe('projectForName', () => {
  it('resolves a name to the project already going by it, else to the project it was renamed to', () => {
    const s = filed({ a: 'PP', b: 'NTI' }, { 'project pipeline': 'PP', vetibble: null });
    expect(projectForName(s, 'nti')).toBe('NTI');
    expect(projectForName(s, 'project-pipeline')).toBe('PP');
    expect(projectForName(s, 'Lootopia')).toBe('Lootopia');
    // Emptied into Other: its old name files nothing any more.
    expect(projectForName(s, 'Vetibble')).toBeNull();
  });

  it('lets a project created later under an old name have it back', () => {
    const s = filed({ a: 'Vet', b: 'Vetibble' }, { vetibble: 'Vet' });
    expect(projectForName(s, 'vetibble')).toBe('Vetibble');
  });
});

describe('renameFolder', () => {
  it('takes along the artifacts the folder holds by their title, not only the ones filed in it', () => {
    // « Vetibble chart » shows under Vetibble by its title alone; renamed to a
    // name its title does not hold, the folder must not leave it behind.
    const s = renameFolder(filed({ a: 'Vetibble', b: null }), 'Vetibble', ['a', 'chart'], 'Pet food');
    expect(s.filed).toEqual({ a: 'Pet food', b: null, chart: 'Pet food' });
  });
});

describe('knownProjects', () => {
  it('lists each project once, Other aside', () => {
    expect(knownProjects(filed({ a: 'NTI', b: 'NTI', c: null, d: 'koh-vibe' })).sort()).toEqual(['NTI', 'koh-vibe']);
  });
});

describe('titleProject', () => {
  const projects = ['koh-vibe', 'NTI', 'project-pipeline', 'pipeline', 'Vetibble'];

  it('finds the project a title names, whatever the spelling', () => {
    expect(titleProject('Six îles pour Koh-Vibe', projects)).toBe('koh-vibe');
    expect(titleProject('Journal de bord NTI', projects)).toBe('NTI');
    expect(titleProject('Vetibble — Ration ménagère', projects)).toBe('Vetibble');
  });

  it('takes the most specific name when several match', () => {
    expect(titleProject('Reel Project Pipeline', projects)).toBe('project-pipeline');
  });

  it('finds a renamed project by its old name too', () => {
    const s = filed({ a: 'PP' }, { 'project pipeline': 'PP' });
    expect(projectOfArtifact(artifact('new', { title: 'Reel Project Pipeline' }), s)).toBe('PP');
  });

  it('matches whole words only', () => {
    expect(titleProject('Les NTIs du mois', projects)).toBeUndefined();
    expect(titleProject('Pipelines de données', projects)).toBeUndefined();
    expect(titleProject('Plans du Salon 3D', projects)).toBeUndefined();
  });
});

describe('projectOfArtifact', () => {
  const s = filed({ chosen: 'Vetibble', other: null });

  it('puts an artifact where it was filed, over what its title says', () => {
    expect(projectOfArtifact(artifact('chosen', { title: 'NTI logos' }), s)).toBe('Vetibble');
  });

  it('keeps an artifact filed into Other there, whatever its title says', () => {
    expect(projectOfArtifact(artifact('other', { title: 'Vetibble chart' }), s)).toBeUndefined();
  });

  it('puts an artifact never filed under the project its title names, else nowhere', () => {
    expect(projectOfArtifact(artifact('new', { title: 'Vetibble — calculator' }), s)).toBe('Vetibble');
    expect(projectOfArtifact(artifact('new', { title: 'Tax return' }), s)).toBeUndefined();
  });
});

describe('groupByProject', () => {
  it('lists the projects by name, Other last, each sorted as the flat list was', () => {
    const groups = groupByProject(
      [
        artifact('n-old', { updatedAt: 1 }),
        artifact('misc'),
        artifact('k'),
        artifact('n-pin', { pinned: true, updatedAt: 0 }),
        artifact('n-new', { updatedAt: 5 }),
        artifact('v'),
      ],
      filed({ 'n-old': 'NTI', 'n-new': 'NTI', 'n-pin': 'NTI', k: 'koh-vibe', v: 'Vetibble', misc: null }),
    );
    expect(groups.map((g) => g.project)).toEqual(['koh-vibe', 'NTI', 'Vetibble', undefined]);
    expect(groups[1]?.artifacts.map((a) => a.slug)).toEqual(['n-pin', 'n-new', 'n-old']);
  });

  it('shows no project that has nothing in it', () => {
    const groups = groupByProject([artifact('a')], filed({ a: 'NTI', gone: 'Vetibble' }));
    expect(groups.map((g) => g.project)).toEqual(['NTI']);
  });
});
