import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactProjectsFile } from '../src/paths';
import { readArtifactProjects, updateArtifactProjects } from '../src/artifacts/projects-store';
import { fileArtifacts, fileIfUnfiled, parseArtifactProjects, serializeArtifactProjects } from '../src/artifacts/projects';

// Same convention as test/closed-store.test.ts: `node:fs/promises` delegates to
// the real implementation unless a test arms the override, which injects a
// CONTROLLED interleaving point — another window writing at that exact instant.
const { readFileOverride } = vi.hoisted(() => ({
  readFileOverride: { current: undefined as ((path: string) => Promise<string> | undefined) | undefined },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (path: Parameters<typeof actual.readFile>[0], encoding?: Parameters<typeof actual.readFile>[1]) => {
      const override = readFileOverride.current?.(String(path));
      return override !== undefined ? override : actual.readFile(path, encoding);
    },
  };
});

let home: string;
let file: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'koh-artifact-projects-'));
  file = artifactProjectsFile(home);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  readFileOverride.current = undefined;
});

describe('readArtifactProjects', () => {
  it('reads an absent or unreadable file as nothing filed', async () => {
    expect((await readArtifactProjects(file)).filed).toEqual({});
    await writeFile(file, 'pas du json', 'utf8');
    expect((await readArtifactProjects(file)).filed).toEqual({});
  });
});

describe('updateArtifactProjects', () => {
  it('writes a filing that reads back, and leaves no temporary file behind', async () => {
    await updateArtifactProjects(file, (s) => fileArtifacts(s, ['a'], 'NTI'));
    expect((await readArtifactProjects(file)).filed).toEqual({ a: 'NTI' });
    expect((await readdir(home)).filter((n) => n.startsWith('.tmp'))).toEqual([]);
  });

  it('loses neither filing when two land together in the same window', async () => {
    await Promise.all([
      updateArtifactProjects(file, (s) => fileArtifacts(s, ['a'], 'NTI')),
      updateArtifactProjects(file, (s) => fileArtifacts(s, ['b'], null)),
    ]);
    expect((await readArtifactProjects(file)).filed).toEqual({ a: 'NTI', b: null });
  });

  // The change is applied again to whatever another window wrote, never merged
  // from a stale copy: a publish filing on its own must see a choice made
  // elsewhere a moment before, or it would undo it.
  it('applies the change to what another window wrote between the read and the rename', async () => {
    await updateArtifactProjects(file, (s) => fileArtifacts(s, ['base'], 'NTI'));

    let calls = 0;
    readFileOverride.current = (path) => {
      // The 2nd read is the check-read before the rename, on the first attempt.
      if (!path.endsWith('artifact-projects.json') || (calls += 1) !== 2) return undefined;
      return (async () => {
        const current = await readFile(path, 'utf8');
        await writeFile(path, serializeArtifactProjects(fileArtifacts(parseArtifactProjects(current), ['new'], 'Vetibble')), 'utf8');
        return readFile(path, 'utf8');
      })();
    };

    const out = await updateArtifactProjects(file, (s) => fileIfUnfiled(s, 'new', 'koh-vibe'));

    expect(out.filed).toEqual({ base: 'NTI', new: 'Vetibble' });
    expect((await readArtifactProjects(file)).filed).toEqual({ base: 'NTI', new: 'Vetibble' });
  });
});
