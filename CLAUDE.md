# Koh-Vibe

VSCode extension for a dashboard of running Claude Code sessions.

## Versioning

**One pull request merged into `main` is one version, and only one.** The level is decided
*when the pull request is opened* — that is when we know what ships — and written in its body,
on a line of its own:

```
Version: minor
```

| Level | When |
|---|---|
| `major` | A break for the user, or a broken contract: spool format, Claude Code hook contract, state file names. |
| `minor` | A new capability, visible to the user. |
| `patch` | A fix, an internal rework, documentation, dependencies, content. **The default when in doubt.** |

Commits pushed straight to `main` do not bump on their own: they ship inside the version of the
next pull request.

### `package.json` is the source of truth

The `version` field of `package.json` **is** the extension's version. It is what VSCode, the
Marketplace, the `.vsix` filename and the view's badge all read — and it is what decides the tag
number, not the other way round.

**It is updated in the promotion pull request, before the merge**, never after:

```bash
scripts/set-version.sh minor     # writes the number into package.json, then commit
```

This constraint is not a matter of style. `main` is protected and the Actions token has no
bypass — GitHub reserves those for organisation repositories. **The delivery can therefore push
nothing to `main`**: that is already why the `CHANGELOG.md` entry never lands there. A number
written after the merge would never reach the file, and `package.json` would advertise the first
release's version forever.

Writing the number before the merge has a second effect, the one that motivated the change:
`dev` carries the right version from the promotion onwards. As long as the version was derived
from `git describe`, a package built from `dev` announced the *previous* one — the tag sits on
the merge commit, which `dev` does not contain. The bug was silent and permanent.

The CI on the pull request to `main` checks that the number moved and that it matches the
announced level. It warns; it does not block.

### What the delivery does on its own

Once the pull request is merged, the `version` job of `.github/workflows/cd.yml` **reads the
number from `package.json`** and posts the `vX.Y.Z` tag, the GitHub Release, the label and the
milestone. The `publish` job then puts that build on the Marketplace, under the `tjacquin42`
publisher, using the `VSCE_PAT` repository secret.

**The publication lives in the same run, and it has to.** A tag and a Release created with the
Actions token trigger no workflow — GitHub cuts the recursion at the source — so a workflow
listening on `release: [published]` or on `push: tags` would never start, and would never say
so. `publish` therefore hangs off `needs: version`, and reads the number actually posted from
that job's `tag` output, which `bump-version.sh` writes to `$GITHUB_OUTPUT`.

It refuses to publish when `package.json` and the tag disagree — the case where the promotion
pull request forgot the bump and the script applied the level itself. The version exists then,
but is not online; the run summary carries the two commands that finish the job by hand.

The `CHANGELOG.md` entry is the exception: the job writes it, but cannot push it, for the reason
above. It waits in the job summary under « Entrée de CHANGELOG à reporter », and it is up to a
follow-up pull request to carry it. Without that follow-up, `CHANGELOG.md` contradicts the tags —
which is what happened to `v0.1.0`, `v1.0.0`, and again to `v1.0.1`, `v1.1.0` and `v1.2.0`.

**What the job writes is a heading, not an entry.** It knows the number, the date, the level
and the pull request title, and nothing else — so the follow-up pull request that reports it
also writes what changed underneath, in `Added` / `Changed` / `Fixed` sections, from the body
of the promotion pull request and of the ones it carried. The changelog is read on the
Marketplace, in its own tab, by people who will never open a pull request: a bare link tells
them nothing. An entry that is still a bare link is an entry still waiting for that follow-up.

If `package.json` was not bumped, the delivery does not stop: it applies the announced level to
the current number and says so loudly. A version that ships without a number is a permanent hole
in the history; a number posted one step too far can be corrected.

**Never post a tag, nor a CHANGELOG heading, by hand**: the scripts are the only source of the
number, the date and the level, or the artifacts drift apart. The prose under a heading is the
opposite — it is only ever written by hand. To catch up if needed:

```bash
scripts/bump-version.sh "" 42    # level read from the pull request, pull request number
```

The current version reads from `package.json`, from `gh release list`, or from the top of
`CHANGELOG.md`.

## Language

Three regimes, not to be mixed.

**The code is in English.** Everything an outside contributor reads to understand the
repository: symbol names, comments, commit messages, pull request titles and bodies, merge
messages, branch names, issue labels. The repository is public — a contributor who does not
speak French has to be able to find their way alone.

**This file follows that rule.** It describes the tooling of a public repository, and anyone
who wants to work on that tooling has to be able to read it. It has no French twin: unlike the
information files below, it has a single audience, and a second copy would only rot.

**Information files are bilingual.** `README.md` and `CONTRIBUTING.md` exist in English (the
main file) and in French (`.fr.md` suffix). English is authoritative; French follows. Both
versions change in the same commit — a translation that lags is worse than a missing one,
because it asserts something false.

`CHANGELOG.md` escapes the rule: its headings come from `bump-version.sh` and from pull request
titles, which are in English, and the prose under them is written in the same language.
Translating it would mean translating titles that already shipped.

**Displayed text follows the user.** No visible string is hard-coded in one language:
contributed labels go through `package.nls.json`, the ones in the code through
`vscode.l10n.t()`. English is the default — hence the string written in the source — and
`l10n/bundle.l10n.fr.json` carries French. A language with no translation falls back to
English, never to an empty string.
