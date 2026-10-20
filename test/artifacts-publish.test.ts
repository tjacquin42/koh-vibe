import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileNewArtifacts, repositoryOf } from '../src/artifacts/publish';
import { readArtifactProjects, updateArtifactProjects } from '../src/artifacts/projects-store';
import { fileArtifacts, renameProject } from '../src/artifacts/projects';

let root: string;
let home: string;

/** A folder under the fake home, created with its parents. */
const dir = (...parts: string[]): string => {
  const path = join(home, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
};

/** A repository as `git init` leaves it: a `.git` folder. */
const repo = (...parts: string[]): string => {
  const path = dir(...parts);
  mkdirSync(join(path, '.git'), { recursive: true });
  return path;
};

/** A checkout whose `.git` is a file pointing elsewhere — a worktree, or a submodule. */
const linked = (gitdir: string, ...parts: string[]): string => {
  const path = dir(...parts);
  writeFileSync(join(path, '.git'), `gitdir: ${gitdir}\n`);
  return path;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'koh-publish-'));
  home = join(root, 'home');
  mkdirSync(home);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('repositoryOf', () => {
  it('names the repository a directory belongs to, from any folder inside it', async () => {
    const projet = repo('DEV', 'projet');
    expect(await repositoryOf(projet, home)).toBe('projet');
    expect(await repositoryOf(dir('DEV', 'projet', 'packages', 'web'), home)).toBe('projet');
  });

  it('names a worktree after its repository, wherever the worktree sits', async () => {
    const main = repo('DEV', 'projet');
    // Beside the repositories, as `git worktree add ../worktrees/projet/x` leaves it…
    const outside = linked(join(main, '.git', 'worktrees', 'feature-x'), 'DEV', 'worktrees', 'projet', 'feature-x');
    expect(await repositoryOf(outside, home)).toBe('projet');
    // …inside it, as Claude Code's own worktrees are, with a relative pointer…
    const inside = linked('../../../.git/worktrees/socle', 'DEV', 'projet', '.claude', 'worktrees', 'socle');
    expect(await repositoryOf(join(inside, 'src'), home)).toBe('projet');
    // …and off a bare repository.
    const bare = linked(join(home, 'DEV', 'nu.git', 'worktrees', 'y'), 'DEV', 'nu-y');
    expect(await repositoryOf(bare, home)).toBe('nu');
  });

  it('names a submodule after itself', async () => {
    repo('DEV', 'projet');
    const sub = linked('../../.git/modules/vendor', 'DEV', 'projet', 'vendor');
    expect(await repositoryOf(sub, home)).toBe('vendor');
  });

  it('names nothing outside a repository — the folder holding the projects included', async () => {
    repo('DEV', 'projet');
    expect(await repositoryOf(dir('DEV'), home)).toBeUndefined();
    expect(await repositoryOf(dir('Downloads', 'x'), home)).toBeUndefined();
    expect(await repositoryOf(join(home, 'DEV', 'gone'), home)).toBeUndefined();
  });

  it('never takes a versioned home for a project', async () => {
    mkdirSync(join(home, '.git'));
    expect(await repositoryOf(dir('DEV'), home)).toBeUndefined();
    expect(await repositoryOf(home, home)).toBeUndefined();
  });
});

describe('fileNewArtifacts', () => {
  it('files a new artifact under the repository of the session that published it', async () => {
    const file = join(home, 'artifact-projects.json');
    await updateArtifactProjects(file, (s) => fileArtifacts(fileArtifacts(s, ['kept'], 'NTI'), ['old'], 'koh-vibe'));
    const kohVibe = repo('DEV', 'Koh-Vibe');
    await fileNewArtifacts(
      file,
      [
        { slug: 'new', cwd: join(kohVibe, 'src') },
        // Published from the folder that holds the projects: no project to name.
        { slug: 'loose', cwd: dir('DEV') },
        // Filed already: a publish never moves it.
        { slug: 'kept', cwd: kohVibe },
      ],
      home,
    );
    expect((await readArtifactProjects(file)).filed).toEqual({ kept: 'NTI', old: 'koh-vibe', new: 'koh-vibe' });
  });

  it('files under the new name of a project renamed since — not under the repository’s again', async () => {
    const file = join(home, 'artifact-projects.json');
    await updateArtifactProjects(file, (s) => renameProject(fileArtifacts(s, ['old'], 'project-pipeline'), 'project-pipeline', 'PP'));
    await fileNewArtifacts(file, [{ slug: 'new', cwd: repo('DEV', 'project-pipeline') }], home);
    expect((await readArtifactProjects(file)).filed).toEqual({ old: 'PP', new: 'PP' });
  });
});
