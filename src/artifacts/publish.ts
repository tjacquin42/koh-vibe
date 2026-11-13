import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileIfUnfiled, projectForName } from './projects';
import { readArtifactProjects, updateArtifactProjects } from './projects-store';

/** An artifact a session published, and the directory that session ran in. */
export interface PublishedArtifact {
  slug: string;
  cwd: string;
}

/**
 * The worktree pointer's tail: `<common git dir>/worktrees/<name>`. Not
 * `events/origin.ts`'s markers: those read a worktree off the shape of a
 * path, and a worktree may sit anywhere — beside the repositories as well as
 * inside one. Its `.git` file is the one place that says which it belongs to.
 */
const WORKTREE_POINTER = /^(.*)[\\/]worktrees[\\/][^\\/]+[\\/]?$/;

/**
 * The project a session works in: the repository its directory belongs to,
 * named after the repository's folder — a worktree counting as its
 * repository. Nothing outside a repository: the folder that holds the
 * projects is not one of them.
 *
 * The climb stops at the home directory, which is never a project even when
 * it is versioned: otherwise every directory under it would belong to it.
 */
export async function repositoryOf(cwd: string, home: string): Promise<string | undefined> {
  const stop = resolve(home);
  let dir = resolve(cwd);
  for (;;) {
    if (dir === stop) return undefined;
    const name = await repositoryAt(dir);
    if (name !== undefined) return name;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function repositoryAt(dir: string): Promise<string | undefined> {
  const dotGit = join(dir, '.git');
  let isFile: boolean;
  try {
    const info = await stat(dotGit);
    if (info.isDirectory()) return basename(dir);
    isFile = info.isFile();
  } catch {
    // Absent, or unreadable: not a repository root, look further up.
    return undefined;
  }
  if (!isFile) return undefined;
  // A `.git` FILE: a worktree, or a submodule. Only a worktree is named after
  // another folder; anything unreadable leaves the checkout its own name.
  let text: string;
  try {
    text = await readFile(dotGit, 'utf8');
  } catch {
    return basename(dir);
  }
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1];
  if (pointer === undefined) return basename(dir);
  const common = WORKTREE_POINTER.exec(isAbsolute(pointer) ? pointer : resolve(dir, pointer))?.[1];
  if (common === undefined) return basename(dir);
  // `<repo>/.git` for an ordinary repository, `<repo>.git` for a bare one.
  const name = basename(common);
  return name === '.git' ? basename(dirname(common)) : name.replace(/\.git$/, '');
}

/**
 * Files each new artifact under the project of the session that published it
 * — the project its repository's name stands for, renamed since or not
 * (`projectForName`). One published outside a repository is left alone — it
 * shows where its title points, or under « Other » — and one ever filed is
 * never moved: a publish does not undo a choice (`fileIfUnfiled`).
 *
 * One failure does not stop the others: the events are gone from the spool by
 * now, and what is not filed here never will be — `onError` says which.
 */
export async function fileNewArtifacts(
  file: string,
  published: readonly PublishedArtifact[],
  home: string,
  onError: (slug: string, err: unknown) => void = () => undefined,
): Promise<void> {
  for (const { slug, cwd } of published) {
    try {
      // Republishing is what iterating on a page looks like — dozens of calls
      // for one artifact. Once it is filed, they cost one read, not a write.
      if (Object.hasOwn((await readArtifactProjects(file)).filed, slug)) continue;
      const repository = await repositoryOf(cwd, home);
      if (repository === undefined) continue;
      await updateArtifactProjects(file, (s) => {
        const project = projectForName(s, repository);
        return project === null ? s : fileIfUnfiled(s, slug, project);
      });
    } catch (err) {
      onError(slug, err);
    }
  }
}
