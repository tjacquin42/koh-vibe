import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileNewArtifacts } from '../src/artifacts/publish';
import { readArtifactProjects } from '../src/artifacts/projects-store';

// The write fails for one artifact, and one only: what a full disk or a
// permission refused looks like from here. Everything else is the real store.
const { failFor } = vi.hoisted(() => ({ failFor: { slug: '' } }));

vi.mock('../src/artifacts/projects-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/artifacts/projects-store')>();
  return {
    ...actual,
    updateArtifactProjects: (file: string, fn: Parameters<typeof actual.updateArtifactProjects>[1]) =>
      actual.updateArtifactProjects(file, (s) => {
        const next = fn(s);
        if (Object.hasOwn(next.filed, failFor.slug) && !Object.hasOwn(s.filed, failFor.slug)) throw new Error('EACCES');
        return next;
      }),
  };
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'koh-publish-errors-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('fileNewArtifacts, when a write fails', () => {
  it('still files the others, and says which one failed', async () => {
    const home = join(root, 'home');
    const projet = join(home, 'DEV', 'projet');
    mkdirSync(join(projet, '.git'), { recursive: true });
    const file = join(home, 'artifact-projects.json');
    failFor.slug = 'first';
    const failed: string[] = [];
    await fileNewArtifacts(
      file,
      [
        { slug: 'first', cwd: projet },
        { slug: 'second', cwd: projet },
      ],
      home,
      (slug) => failed.push(slug),
    );
    expect(failed).toEqual(['first']);
    expect((await readArtifactProjects(file)).filed).toEqual({ second: 'projet' });
  });
});
