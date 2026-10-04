#!/usr/bin/env node
// Writes build-info.json at the package root, read by the view to show what
// is actually running.
//
// The version comes from package.json, which is the source of truth
// (CLAUDE.md): it is bumped in the promotion PR, so BEFORE the merge, and
// follows the current branch.
//
// It used to come from `git describe`, and that was a silent trap: the tag is
// set on the merge commit of the PR into `main`, which `dev` does not
// contain. Any package built from `dev` therefore announced the previous
// version — or "no version" as long as no tag had been fetched locally. A
// manifest cannot go missing that way: it is in the tree.
//
// The commit travels alongside the version because the version alone does
// not distinguish two successive packages: it only moves at promotion time,
// while a build gets installed at every fix. Without it, "I reloaded and
// it's the same" stays an unanswered question.
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const git = (args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// An unreadable manifest, or one with no valid number, does not invent a
// version: the view says "no version", which is true, rather than showing a
// dubious number.
function released() {
  let version;
  try {
    ({ version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
  } catch {
    return {};
  }
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return {};
  const tag = `v${version}`;
  // "+7" = seven commits since the promotion that set this number. The count
  // needs the matching tag; it can be missing (a freshly cloned repository
  // without its tags, a build outside the repository). The gap is then
  // omitted, never guessed — the version stays correct, it only loses its
  // precision.
  try {
    const ahead = Number(git(['rev-list', '--count', `${tag}..HEAD`]).trim());
    return Number.isFinite(ahead) ? { version: tag, ahead } : { version: tag };
  } catch {
    return { version: tag };
  }
}

// The star does not mean "the repository is dirty", but "this package does
// not match this commit". So only the paths whose content ends up in the
// .vsix matter (see .vscodeignore): a local .vscode/ or a modified test
// change nothing about what runs, and if they lit the marker permanently it
// would stop meaning anything.
// The list follows .vscodeignore, minus the files that do not change what
// runs: README and CHANGELOG ship in the package but are documentation.
// `src/` stands in for `out/` (compiled from it), `l10n/` and the package.nls
// files carry the displayed labels, and scripts/install-hooks.cjs is executed
// by the extension at runtime.
const PACKAGED =
  /^(src|resources|bin|l10n)\/|^(package\.json|package\.nls(\.fr)?\.json|tsconfig\.json|\.vscodeignore|scripts\/install-hooks\.cjs)$/;

function changedPath(line) {
  // Porcelain format: two status columns, a space, then the path —
  // "old -> new" for a rename, of which only the destination exists.
  const path = line.slice(3);
  const arrow = path.indexOf(' -> ');
  return arrow === -1 ? path : path.slice(arrow + 4);
}

// Outside a git repository, the commit and the marker are missing — not the
// version, which is in the manifest. The file is therefore written anyway: a
// package rebuilt elsewhere shows "v1.2.0" rather than nothing at all.
function build() {
  try {
    const commit = git(['rev-parse', '--short=7', 'HEAD']).trim();
    const dirty = git(['status', '--porcelain'])
      .split('\n')
      .filter((l) => l.length > 3)
      .map(changedPath)
      .some((p) => PACKAGED.test(p));
    return { commit, dirty };
  } catch {
    return {};
  }
}

writeFileSync(join(root, 'build-info.json'), JSON.stringify({ ...released(), ...build() }) + '\n', 'utf8');
