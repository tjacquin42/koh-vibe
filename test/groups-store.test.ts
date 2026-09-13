import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, createGroup, deleteGroup, emptyGroups, parseGroups, reorderGroups, serializeGroups, sessionOrderOf, setGroupColor, setSessionOrder } from '../src/groups/model';
import { readGroups, updateGroups } from '../src/groups/store';

// `node:fs/promises` is a native module, mocked entirely by delegating to the
// real implementation except when a test arms one of the overrides — same
// convention as test/watcher.test.ts. Used to inject a DRIVEN interleaving
// point (never timed): a write from another window triggered from inside a
// specific call to `readFile`, or a failure triggered from a specific call to
// `rename`, rather than a race hoped for with delays.
const { readFileOverride, renameOverride } = vi.hoisted(() => ({
  readFileOverride: { current: undefined as ((path: string) => Promise<string> | undefined) | undefined },
  renameOverride: {
    current: undefined as ((oldPath: string, newPath: string) => Promise<void> | undefined) | undefined,
  },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (
      path: Parameters<typeof actual.readFile>[0],
      encoding?: Parameters<typeof actual.readFile>[1],
    ) => {
      const override = readFileOverride.current?.(String(path));
      return override !== undefined ? override : actual.readFile(path, encoding);
    },
    rename: (
      oldPath: Parameters<typeof actual.rename>[0],
      newPath: Parameters<typeof actual.rename>[1],
    ) => {
      const override = renameOverride.current?.(String(oldPath), String(newPath));
      return override !== undefined ? override : actual.rename(oldPath, newPath);
    },
  };
});

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'koh-groups-'));
  file = join(dir, 'groups.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  readFileOverride.current = undefined;
  renameOverride.current = undefined;
});

describe('groups store', () => {
  it('a missing file counts as an empty groups state', async () => {
    expect(await readGroups(join(dir, 'rien.json'))).toEqual(emptyGroups());
  });

  it('an unreadable file counts as an empty groups state, without throwing', async () => {
    await writeFile(file, 'pas du json');
    expect(await readGroups(file)).toEqual(emptyGroups());
  });

  it('rereads just before writing: another window\'s edit survives', async () => {
    await updateGroups(file, (s) => createGroup(s, 'mien', () => 'g1'));
    // injected interleaving point: another window writes during our transform
    const out = await updateGroups(file, async (s) => {
      await writeFile(
        file,
        serializeGroups(createGroup(parseGroups(await readFile(file, 'utf8')), 'sien', () => 'g2')),
      );
      return assign(s, 's1', 'g1');
    });
    expect(out.groups.map((g) => g.name)).toEqual(['mien', 'sien']);
  });

  it('a color set here survives another window\'s simultaneous write', async () => {
    // The original bug: the merge only propagated the name, and silently
    // dropped every other attribute of the folder.
    await updateGroups(file, (s) => createGroup(s, 'mien', () => 'g1'));
    const out = await updateGroups(file, async (s) => {
      await writeFile(
        file,
        serializeGroups(createGroup(parseGroups(await readFile(file, 'utf8')), 'sien', () => 'g2')),
      );
      return setGroupColor(s, 'g1', 'purple');
    });
    expect(out.groups.map((g) => [g.name, g.color])).toEqual([
      ['mien', 'purple'],
      ['sien', undefined],
    ]);
    expect((await readGroups(file)).groups[0]?.color).toBe('purple');
  });

  it('a color removed here is not resurrected by the fresher state', async () => {
    await updateGroups(file, (s) => setGroupColor(createGroup(s, 'mien', () => 'g1'), 'g1', 'red'));
    const out = await updateGroups(file, async (s) => {
      await writeFile(
        file,
        serializeGroups(createGroup(parseGroups(await readFile(file, 'utf8')), 'sien', () => 'g2')),
      );
      return setGroupColor(s, 'g1', undefined);
    });
    expect(out.groups[0]).not.toHaveProperty('color');
  });

  it('filing into a folder does not erase the order another window sets in a different one', async () => {
    // The bug this test guards against: taking `after.sessionOrder` wholesale
    // overwrote every folder, not just the one we had just filed into.
    await updateGroups(file, (s) => createGroup(createGroup(s, 'mien', () => 'g1'), 'sien', () => 'g2'));
    const out = await updateGroups(file, async (s) => {
      const fresh = parseGroups(await readFile(file, 'utf8'));
      await writeFile(file, serializeGroups(setSessionOrder(fresh, 'g2', ['x', 'y'])));
      return setSessionOrder(s, 'g1', ['a', 'b']);
    });
    expect(sessionOrderOf(out, 'g1')).toEqual(['a', 'b']);
    expect(sessionOrderOf(out, 'g2')).toEqual(['x', 'y']);
    const reread = await readGroups(file);
    expect(sessionOrderOf(reread, 'g2')).toEqual(['x', 'y']);
  });

  it('an order reordered here wins over the older one from the file', async () => {
    await updateGroups(file, (s) => setSessionOrder(createGroup(s, 'mien', () => 'g1'), 'g1', ['a', 'b', 'c']));
    const out = await updateGroups(file, async (s) => {
      const fresh = parseGroups(await readFile(file, 'utf8'));
      await writeFile(file, serializeGroups(createGroup(fresh, 'ailleurs', () => 'g2')));
      return setSessionOrder(s, 'g1', ['c', 'a', 'b']);
    });
    expect(sessionOrderOf(out, 'g1')).toEqual(['c', 'a', 'b']);
    expect(out.groups.map((g) => g.name)).toEqual(['mien', 'ailleurs']);
  });

  it('a folder deleted here stays deleted even when the other window did not know about it', async () => {
    await updateGroups(file, (s) => createGroup(s, 'à supprimer', () => 'g1'));
    // injected interleaving point: another window, unaware of the deletion in
    // progress, writes an unrelated folder during our transform
    const out = await updateGroups(file, async (s) => {
      await writeFile(
        file,
        serializeGroups(createGroup(parseGroups(await readFile(file, 'utf8')), 'ailleurs', () => 'g2')),
      );
      return deleteGroup(s, 'g1');
    });
    expect(out.groups.map((g) => g.name)).toEqual(['ailleurs']);
  });

  it('an assignment made elsewhere does not disappear just because we did not know about it', async () => {
    await updateGroups(file, (s) => createGroup(s, 'dossier', () => 'g1'));
    // injected interleaving point: another window assigns a session during our
    // transform, which itself only touches a folder unrelated to that assignment
    const out = await updateGroups(file, async (s) => {
      await writeFile(
        file,
        serializeGroups(assign(parseGroups(await readFile(file, 'utf8')), 'session-ailleurs', 'g1')),
      );
      return createGroup(s, 'autre', () => 'g2');
    });
    expect(out.assignments).toEqual({ 'session-ailleurs': 'g1' });
    expect(out.groups.map((g) => g.name).sort()).toEqual(['autre', 'dossier']);
  });

  // Fix round 2, Minor: a deletion concurrent with an assignment to the same
  // folder produces a transient orphaned assignment in `updateGroups`'s
  // immediate result (the merge doesn't know `parseGroups`'s invariants, it
  // only combines). It doesn't persist: `parseGroups`, called by any
  // subsequent read, already filters out any assignment that points to no
  // existing folder (see groups-model.test.ts).
  it('a transient orphaned assignment corrects itself on the next read', async () => {
    await updateGroups(file, (s) => createGroup(s, 'à supprimer', () => 'g1'));
    // injected interleaving point: another window assigns a session to g1 while
    // we delete it, without knowing the deletion is in progress
    const out = await updateGroups(file, async (s) => {
      await writeFile(
        file,
        serializeGroups(assign(parseGroups(await readFile(file, 'utf8')), 's-orpheline', 'g1')),
      );
      return deleteGroup(s, 'g1');
    });

    // immediate transient state: the merge writes the orphaned assignment as is
    expect(out.groups).toEqual([]);
    expect(out.assignments).toEqual({ 's-orpheline': 'g1' });

    // the next read self-corrects
    expect((await readGroups(file)).assignments).toEqual({});
  });

  it('writes atomically: no temporary file is left behind', async () => {
    await updateGroups(file, (s) => createGroup(s, 'x', () => 'g1'));
    const restes = (await readdir(dir)).filter((n) => n.startsWith('.tmp'));
    expect(restes).toEqual([]);
  });

  // Fix round 2, Important: this behavior was already correct (verified at
  // runtime by the reviewer) but uncovered — exactly the kind of guarantee
  // that breaks silently, like the freeze hit in the previous batch on a
  // reentrancy guard whose flag stayed raised.
  it('a rename that fails leaves no temporary file behind', async () => {
    renameOverride.current = () => Promise.reject(new Error('disque plein'));

    await expect(updateGroups(file, (s) => createGroup(s, 'x', () => 'g1'))).rejects.toThrow('disque plein');

    renameOverride.current = undefined;
    const restes = (await readdir(dir)).filter((n) => n.startsWith('.tmp'));
    expect(restes).toEqual([]);
  });

  // Fix round 2, Important: same as above — a transform that throws must not
  // leave the queue stuck forever (this is exactly the freeze hit in the
  // previous batch).
  it('a transform that throws does not block the queue for subsequent calls', async () => {
    await expect(
      updateGroups(file, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const out = await updateGroups(file, (s) => createGroup(s, 'après', () => 'g1'));
    expect(out.groups.map((g) => g.name)).toEqual(['après']);
  });

  it('preserves unknown fields through a round trip', async () => {
    await writeFile(file, JSON.stringify({ version: 1, groups: [], assignments: {}, futur: 42 }));
    await updateGroups(file, (s) => createGroup(s, 'x', () => 'g1'));
    const written = JSON.parse(await readFile(file, 'utf8')) as { futur: number };
    expect(written.futur).toBe(42);
  });

  // Fix round 1 (mechanism 2): an external write that occurs exactly between
  // our merge (the content we just read as `latest`) and our `rename` must be
  // absorbed by a new attempt rather than overwritten. Driven interleaving
  // point: the 3rd call to `readFile` on this file — the control reread done
  // right before renaming, at the end of the first attempt — triggers a real
  // write before yielding back, simulating another window writing at that
  // exact instant.
  it('an external write between the merge and the rename is absorbed by a new attempt', async () => {
    await updateGroups(file, (s) => createGroup(s, 'base', () => 'g-base'));

    let calls = 0;
    readFileOverride.current = (path) => {
      if (!path.endsWith('groups.json') || (calls += 1) !== 3) return undefined;
      return (async () => {
        const current = await readFile(path, 'utf8');
        await writeFile(
          path,
          serializeGroups(createGroup(parseGroups(current), 'ailleurs', () => 'g-else')),
          'utf8',
        );
        return readFile(path, 'utf8');
      })();
    };

    const out = await updateGroups(file, (s) => createGroup(s, 'mine', () => 'g-mine'));

    expect(out.groups.map((g) => g.name).sort()).toEqual(['ailleurs', 'base', 'mine']);
  });

  // Fix round 2, Critical: the last attempt must reread too before renaming,
  // exactly like the previous ones — it's the attempt we only reach under
  // real, sustained contention, so precisely the one where another window is
  // most likely to be writing. Three external writes are injected, one at each
  // control reread (the three only budgeted attempts): if the last reread were
  // still skipped, the third addition would be silently overwritten by the
  // final `rename`. The `readFile` overrides below use synchronous `node:fs`
  // (unmocked) for the external write, so as not to re-enter the mocked
  // `readFile` and throw off the call counter.
  it('the last attempt rereads too before renaming, under sustained contention', async () => {
    await updateGroups(file, (s) => createGroup(s, 'base', () => 'g-base'));

    let calls = 0;
    readFileOverride.current = (path) => {
      calls += 1;
      if (!path.endsWith('groups.json') || calls < 3 || calls > 5) return undefined;
      const label = `ext${calls - 2}`;
      const current = readFileSync(path, 'utf8');
      writeFileSync(path, serializeGroups(createGroup(parseGroups(current), label, () => `g-${label}`)), 'utf8');
      return Promise.resolve(readFileSync(path, 'utf8'));
    };

    const out = await updateGroups(file, (s) => createGroup(s, 'mine', () => 'g-mine'));

    expect(out.groups.map((g) => g.name).sort()).toEqual(['base', 'ext1', 'ext2', 'ext3', 'mine']);
  });

  // Fix round 1 (mechanism 1): reactivated. This test (verbatim from the
  // brief) failed reproducibly against the first implementation — measured at
  // 0/30 (see task-5-report.md). This wasn't a defect in
  // mergeGroups/mergeAssignments (the tests above prove they merge correctly
  // as soon as they're given a coherent `latest` snapshot), but the absence of
  // any guarantee that two calls to `updateGroups` on the same file, launched
  // from the same process, never run at the same time. `updateGroups` now
  // serializes these calls per file (`enqueue`): exactly the case that
  // `Promise.all` exercises here.
  it('two concurrent updates are not lost', async () => {
    await Promise.all([
      updateGroups(file, (s) => createGroup(s, 'a', () => 'ga')),
      updateGroups(file, (s) => createGroup(s, 'b', () => 'gb')),
    ]);
    expect((await readGroups(file)).groups).toHaveLength(2);
  });

  it('carries a reorder through the merge, which edits nothing but `order`', async () => {
    // The regression this guards: `sameAttributes` decides which folders our
    // edit is allowed to push onto the freshest state. While `order` was absent
    // from it, a reorder compared equal to what came before, no folder counted
    // as edited, and the whole gesture was dropped on write without a word.
    await updateGroups(file, (s) => createGroup(createGroup(s, 'a', () => 'ga'), 'b', () => 'gb'));

    await updateGroups(file, (s) => reorderGroups(s, ['gb'], 'ga'));

    expect((await readGroups(file)).groups.map((g) => g.id)).toEqual(['gb', 'ga']);
  });

  it('keeps a reorder even when another window renamed a folder in between', async () => {
    await updateGroups(file, (s) => createGroup(createGroup(s, 'a', () => 'ga'), 'b', () => 'gb'));

    // The other window writes between our read and our rename, so the merge has
    // to combine its rename with our reorder rather than choose between them.
    let armed = true;
    readFileOverride.current = (path) => {
      if (!armed || !path.endsWith('groups.json')) return undefined;
      armed = false;
      const fresh = parseGroups(readFileSync(file, 'utf8'));
      writeFileSync(
        file,
        serializeGroups({ ...fresh, groups: fresh.groups.map((g) => (g.id === 'ga' ? { ...g, name: 'renamed' } : g)) }),
        'utf8',
      );
      return undefined;
    };

    await updateGroups(file, (s) => reorderGroups(s, ['gb'], 'ga'));

    const after = await readGroups(file);
    expect(after.groups.map((g) => g.id)).toEqual(['gb', 'ga']);
    expect(after.groups.find((g) => g.id === 'ga')?.name).toBe('renamed');
  });
});
