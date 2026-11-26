import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  artifactsOfGroup,
  createGroup,
  deleteGroup,
  emptyGroups,
  fileArtifactsInGroup,
  parseGroups,
  serializeGroups,
  setArtifactOrder,
  unfileArtifacts,
  type GroupsState,
} from '../src/groups/model';
import { updateGroups } from '../src/groups/store';

const twoFolders = (): GroupsState => {
  let s = createGroup(emptyGroups(), 'VIDEO', () => 'g1');
  s = createGroup(s, 'PRO', () => 'g2');
  return s;
};

describe('artifacts filed in a Sessions folder', () => {
  it('files an artifact with its title, and lists it under its folder only', () => {
    const s = fileArtifactsInGroup(twoFolders(), [{ slug: 'a1', title: 'Carnet' }], 'g1');
    expect(artifactsOfGroup(s, 'g1')).toEqual([{ slug: 'a1', title: 'Carnet' }]);
    expect(artifactsOfGroup(s, 'g2')).toEqual([]);
  });

  it('moves an artifact filed again to the end of its new folder', () => {
    let s = fileArtifactsInGroup(twoFolders(), [{ slug: 'a1', title: 'A' }, { slug: 'a2', title: 'B' }], 'g1');
    s = fileArtifactsInGroup(s, [{ slug: 'a1', title: 'A' }], 'g2');
    expect(artifactsOfGroup(s, 'g1').map((a) => a.slug)).toEqual(['a2']);
    expect(artifactsOfGroup(s, 'g2').map((a) => a.slug)).toEqual(['a1']);
  });

  it('keeps the recorded title when the new one is unknown', () => {
    let s = fileArtifactsInGroup(twoFolders(), [{ slug: 'a1', title: 'Carnet' }], 'g1');
    s = fileArtifactsInGroup(s, [{ slug: 'a1', title: '' }], 'g2');
    expect(artifactsOfGroup(s, 'g2')).toEqual([{ slug: 'a1', title: 'Carnet' }]);
  });

  it('refuses an unknown folder and a slug that is not one', () => {
    const base = twoFolders();
    expect(fileArtifactsInGroup(base, [{ slug: 'a1', title: 'A' }], 'nope')).toBe(base);
    const s = fileArtifactsInGroup(base, [{ slug: '__proto__', title: 'x' }, { slug: '../x', title: 'y' }], 'g1');
    expect(artifactsOfGroup(s, 'g1')).toEqual([]);
  });

  it('unfiles, and drops the artifacts of a deleted folder', () => {
    let s = fileArtifactsInGroup(twoFolders(), [{ slug: 'a1', title: 'A' }], 'g1');
    s = fileArtifactsInGroup(s, [{ slug: 'a2', title: 'B' }], 'g2');
    expect(artifactsOfGroup(unfileArtifacts(s, ['a1']), 'g1')).toEqual([]);
    const gone = deleteGroup(s, 'g1');
    expect(gone.artifacts).toEqual({ a2: { group: 'g2', title: 'B' } });
  });

  it('round-trips through the file, and ignores entries pointing at no folder', () => {
    const s = fileArtifactsInGroup(twoFolders(), [{ slug: 'a1', title: 'A' }], 'g1');
    expect(parseGroups(serializeGroups(s)).artifacts).toEqual(s.artifacts);
    const raw = JSON.parse(serializeGroups(s)) as Record<string, unknown>;
    raw['artifacts'] = { a1: { group: 'g1', title: 'A' }, a2: { group: 'gone', title: 'B' }, a3: 'nope' };
    expect(parseGroups(JSON.stringify(raw)).artifacts).toEqual({ a1: { group: 'g1', title: 'A' } });
  });

  it('a file written before artifacts existed reads as none', () => {
    expect(parseGroups(JSON.stringify({ version: 1, groups: [] })).artifacts).toEqual({});
  });
});

describe('artifacts in the shared groups file', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'koh-groups-artifacts-'));
    file = join(dir, 'groups.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('filing one artifact here keeps the one another window filed meanwhile', async () => {
    await writeFile(file, serializeGroups(twoFolders()));
    const out = await updateGroups(file, async (s) => {
      const theirs = fileArtifactsInGroup(parseGroups(await readFile(file, 'utf8')), [{ slug: 'b1', title: 'B' }], 'g2');
      await writeFile(file, serializeGroups(theirs));
      return fileArtifactsInGroup(s, [{ slug: 'a1', title: 'A' }], 'g1');
    });
    expect(out.artifacts).toEqual({ b1: { group: 'g2', title: 'B' }, a1: { group: 'g1', title: 'A' } });
  });

  it('drops an artifact filed here into a folder another window has just deleted', async () => {
    await writeFile(file, serializeGroups(twoFolders()));
    const out = await updateGroups(file, async (s) => {
      await writeFile(file, serializeGroups(deleteGroup(parseGroups(await readFile(file, 'utf8')), 'g1')));
      return fileArtifactsInGroup(s, [{ slug: 'a1', title: 'A' }], 'g1');
    });
    expect(out.artifacts).toEqual({});
  });
});

describe('the order of a folder\'s artifacts (21/11)', () => {
  const filedThree = (): GroupsState =>
    fileArtifactsInGroup(twoFolders(), [{ slug: 'a1', title: 'A' }, { slug: 'a2', title: 'B' }, { slug: 'a3', title: 'C' }], 'g1');
  const slugsOf = (s: GroupsState, g = 'g1'): string[] => artifactsOfGroup(s, g).map((a) => a.slug);

  it('lists them as dragged, then the others in the order they were filed', () => {
    const s = setArtifactOrder(filedThree(), 'g1', ['a3', 'a1']);
    expect(slugsOf(s)).toEqual(['a3', 'a1', 'a2']);
    // One filed later lands at the end.
    expect(slugsOf(fileArtifactsInGroup(s, [{ slug: 'a4', title: 'D' }], 'g1'))).toEqual(['a3', 'a1', 'a2', 'a4']);
  });

  it('survives the file, and is not written until something is dragged', () => {
    expect(serializeGroups(filedThree())).not.toContain('artifactOrder');
    const s = setArtifactOrder(filedThree(), 'g1', ['a2', 'a3', 'a1']);
    expect(slugsOf(parseGroups(serializeGroups(s)))).toEqual(['a2', 'a3', 'a1']);
    expect(setArtifactOrder(s, 'g1', []).artifactOrder).toBeUndefined();
  });

  it('refuses an unknown folder, and goes with its folder', () => {
    const s = filedThree();
    expect(setArtifactOrder(s, 'nope', ['a1'])).toBe(s);
    expect(deleteGroup(setArtifactOrder(s, 'g1', ['a3']), 'g1').artifactOrder).toBeUndefined();
  });
});

describe('the order of a folder\'s artifacts in the shared file (21/11)', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'koh-groups-artifact-order-'));
    file = join(dir, 'groups.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is written though nothing else changes, and keeps the order another window set in another folder', async () => {
    const start = fileArtifactsInGroup(
      fileArtifactsInGroup(twoFolders(), [{ slug: 'a1', title: 'A' }, { slug: 'a2', title: 'B' }], 'g1'),
      [{ slug: 'b1', title: 'C' }, { slug: 'b2', title: 'D' }],
      'g2',
    );
    await writeFile(file, serializeGroups(start));
    const out = await updateGroups(file, async (s) => {
      await writeFile(file, serializeGroups(setArtifactOrder(parseGroups(await readFile(file, 'utf8')), 'g2', ['b2', 'b1'])));
      return setArtifactOrder(s, 'g1', ['a2', 'a1']);
    });
    expect(artifactsOfGroup(out, 'g1').map((a) => a.slug)).toEqual(['a2', 'a1']);
    expect(artifactsOfGroup(out, 'g2').map((a) => a.slug)).toEqual(['b2', 'b1']);
    expect(artifactsOfGroup(parseGroups(await readFile(file, 'utf8')), 'g1').map((a) => a.slug)).toEqual(['a2', 'a1']);
  });
});
