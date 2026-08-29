# Changelog — Koh-Vibe

Every released version. **One version = one pull request merged into `main`.**

The number follows [semver](https://semver.org/): `major` for a break (spool format, hook
contract), `minor` for a new user-visible capability, `patch` for a fix, an internal rework or
documentation.

Each entry names the promotion pull request that delivered it, the pull requests it carried,
and then says what actually changed for someone using the extension.

`scripts/bump-version.sh` writes the heading and the promotion line on its own at release
time. The detail underneath is written by hand, in the follow-up pull request that reports the
entry — `main` is protected, so the delivery can never push this file itself, and an entry
that arrives as a bare link is an entry still waiting for that pull request.

## [1.2.0](https://github.com/tjacquin42/koh-vibe/releases/tag/v1.2.0) — 2026-08-27

`minor` · [#17](https://github.com/tjacquin42/koh-vibe/pull/17) — Keep every conversation — greyed when ended, temporary until filed, brought back for real — and start new ones from the dashboard

Carries [#13](https://github.com/tjacquin42/koh-vibe/pull/13),
[#14](https://github.com/tjacquin42/koh-vibe/pull/14),
[#15](https://github.com/tjacquin42/koh-vibe/pull/15) and
[#16](https://github.com/tjacquin42/koh-vibe/pull/16).

### Added

- **Persistent sessions**, the first checkbox of the settings, on by default: an ended
  conversation stays in the list, greyed out, in its folder, with a muted dot and the time it
  closed. The fifty most recent are kept. Unchecked, closing a tab removes the row instead.
- **Reopening brings back that very conversation**, never a blank one — the editor tab when
  Claude Code will find the transcript from this window, a terminal `claude --resume`
  otherwise. The row spins in place of its dot while it comes back, and takes no second click:
  a second click used to open a second tab.
- **Temporary sessions** replaces *Unfiled*. A conversation filed in no folder leaves the list
  after 24 h without activity — hidden, not forgotten: any activity brings it back, and filing
  it in a folder keeps it for good. A second checkbox turns that off.
- **New session from the dashboard** — a **+** in the view title, and another at the right of a
  folder row on hover, which files the conversation in that folder as soon as it appears.
- **Two default chimes travel in the package** — *Attente* and *Fin* — so a fresh install is
  not silent, library or no library. A sound already chosen, a chosen silence included, stays
  as it is; an update never puts them back.
- **Usage per model**, when the plan counts one apart.
- **A spinner on the row** while a conversation comes back, and on *Recently closed* while it
  loads.

### Changed

- **A conversation is no longer forgotten for going quiet.** The 24 h purge that emptied rows
  on silence is gone: a conversation leaves the list when it ends, when you close it, or when
  you remove it. A tab left open for a day is still a conversation.
- **Refresh brings back what the list lost.** It reads Claude Code's own registry of running
  processes (`~/.claude/sessions/`) and restores every live conversation, in the folder it was
  filed in. The same pass runs when the window opens, and a few seconds after a conversation
  vanishes while its process still runs — the same conversation open in two editors, one of
  them quitting.
- **Restored tabs count as open sessions.** After a window reload, every Claude tab still open
  is listed as idle — never greyed, never opened twice: a click brings it to the front by its
  position.
- **The trash closes in one click** — the tab and the row at once, whatever *Persistent
  sessions* says, that setting being about the tabs you close yourself. A tab the editor
  restored is closed in place, without being opened first. When no tab is found, the row is
  simply removed.
- **Rows are named as the tabs are** — the title you gave, else the one Claude generated, else
  the last prompt. A conversation that never got a message leaves neither row nor history.
- ***Recently closed*** keeps its own view, beside Usage and Settings, whatever the two new
  settings say.
- **`sh install.sh` is the documented install**, so no `.vsix` version number to keep in step
  in the README.

### Under the hood

- The three-way merge of `groups.json`, `closed.json` and `settings.json` was written three
  times; it is one piece of machinery now. The transcript cache is cleaned once per render
  rather than per row.

## [1.1.0](https://github.com/tjacquin42/koh-vibe/releases/tag/v1.1.0) — 2026-08-17

`minor` · [#12](https://github.com/tjacquin42/koh-vibe/pull/12) — Close a conversation, keep ten of them, and move the folders

Carries [#7](https://github.com/tjacquin42/koh-vibe/pull/7),
[#8](https://github.com/tjacquin42/koh-vibe/pull/8),
[#9](https://github.com/tjacquin42/koh-vibe/pull/9),
[#10](https://github.com/tjacquin42/koh-vibe/pull/10) and
[#11](https://github.com/tjacquin42/koh-vibe/pull/11).

### Added

- **Close a conversation** — a trash icon on every row. It closes the conversation's Claude
  tab and archives the row; when no tab is found, it takes the row out of the list. A
  conversation still working asks for confirmation first. Koh-Vibe archives on its own rather
  than waiting for a `SessionEnd` that may never come, so the gesture holds either way.
- **Folders move by dragging**, the way conversations already did — drop one onto another to
  put it in front.
- **`install.sh`** — one command at the repository root builds and installs into the editor
  its terminal belongs to, rather than into whatever `code` resolves to on the `PATH`. The
  throwaway version number is driven by the clock, so a reinstall always outranks what is
  already there.

### Changed

- ***Recently closed* left the bottom of the session tree for a view of its own**, beside
  Usage and Settings, and keeps ten entries instead of five. At ten, inside the tree, it
  competed for room with the live sessions and pushed them off screen. One click reopens.

### Fixed

- **Reordering folders could not be persisted, by construction.** `mergeGroups` renumbered
  `order` from the incoming state's position. Order is positional now and stays out of
  `sameAttributes`, so another window's rename still wins on the attributes it owns.

## [1.0.1](https://github.com/tjacquin42/koh-vibe/releases/tag/v1.0.1) — 2026-08-15

`patch` · [#6](https://github.com/tjacquin42/koh-vibe/pull/6) — fix: truthful version label, readable status dots, changelog in step with the tags

Carries [#4](https://github.com/tjacquin42/koh-vibe/pull/4) and
[#5](https://github.com/tjacquin42/koh-vibe/pull/5).

### Fixed

- **The sidebar announced the wrong version.** `stamp-build.cjs` resolved it with
  `git describe`, which returns the nearest tag reachable from `HEAD`; that tag sits on the
  merge commit, which `dev` never contains — so any package built from `dev` announced the
  *previous* version, and none at all before a tag had been fetched. `package.json` is the
  source of truth now, written before the merge by `scripts/set-version.sh`.
- **Clicking a session turned its status dot grey**, unreadable on the one row you had just
  picked: VSCode forces `color: currentColor !important` on a selected row's icon, but only
  for codicons. Each status ships an SVG disc now, out of that rule's reach.

### Documentation

- **The changelog contradicted the tags.** `v0.1.0` and `v1.0.0` had both been released
  without ever being written down. Both entries were restored, and `CLAUDE.md` stopped listing
  that entry among the things the delivery does on its own.
- `CLAUDE.md` is in English, like the rest of the repository.

## [1.0.0](https://github.com/tjacquin42/koh-vibe/releases/tag/v1.0.0) — 2026-08-14

`major` · [#3](https://github.com/tjacquin42/koh-vibe/pull/3) — feat!: Koh-Vibe — folders, chimes, usage, localisation and CI

Carries [#2](https://github.com/tjacquin42/koh-vibe/pull/2) and the 42 commits accumulated on
`dev` since v0.1.0.

### Breaking

- **The extension is renamed koh-claude → Koh-Vibe**, identifiers included: command ids, view
  id, MIME type, bridge names, package name, and the state root `~/.koh-claude` →
  `~/.koh-vibe`.
- **Upgrading.** `migrateLegacyHome` renames the state directory — sessions, folders, ordering
  and backups move as one — and only when the new root does not already exist, the new root
  winning otherwise rather than being overwritten. `KOH_LEGACY_MARKER` stays recognised on
  uninstall and cleanup, never written, so hooks installed under the old name can still be
  removed. The previous extension stays alive in open windows until the editor is **quit** — a
  reload is not enough — and recreates an empty `~/.koh-claude` while it runs.

### Added

- **Folders** — a pure model, shared persistence re-read just before each write, drag and
  drop, manual ordering, folder commands. An assignment disappears with the session it filed.
- **Focus** — clicking a session reveals the window it already runs in instead of opening a
  new context.
- **Sounds** — the Kenney CC0 library, one chime per event, choosable globally, per folder and
  per conversation, with volume.
- **Usage** — 5 h and 7 d consumption read from Anthropic and captured at the status line,
  without depending on another tool.
- **Visual identity** — the Koh Rong outline as icon, conversation titles, status pills,
  coloured labels, a pinned footer, a tooltip that holds, and the shipped version and package
  commit at the top of the view.
- **Localisation** — displayed text follows the editor's language.
- **Documentation** — English README and CONTRIBUTING, each with a French twin.
- **CI** — typecheck, tests and packaging on every pull request, on macOS, the platform this
  extension supports; merged head branches are deleted automatically.

501 tests green, end-to-end included.

## [0.1.0](https://github.com/tjacquin42/koh-vibe/releases/tag/v0.1.0) — 2026-08-14

`minor` · [#1](https://github.com/tjacquin42/koh-vibe/pull/1) — feat(tableau-de-bord): affiche les sessions Claude Code en cours

First release, under the name **koh-claude**.

### Added

- **A dashboard of Claude Code sessions** — a tree view in the sidebar and a summary in the
  status bar, showing which sessions run, which one waits for a permission, which has
  finished, and what each consumed in tokens.
- **Sessions are observed through Claude Code's hooks.** A shell bridge drops each hook
  payload into a file spool (`~/.koh-claude/events/`), and every editor window reduces that
  spool into state on its own.

Three decisions carry the rest of the design:

- **The bridge parses nothing, never writes to standard output, and always exits 0.** A hook
  must never be able to disturb the session that calls it — losing an event is the cheaper
  failure. Verified for real against a spool that could not be written to: exit code 0, empty
  output.
- **Windows converge without locks** — a pure reducer, and the state is written *before* the
  event is deleted. That order is what makes concurrency safe.
- **`PermissionRequest` is never blocking and never carries a `timeout`.** Koh-Vibe does not
  decide in your place, and does not dispute the hand with Vibe Island, whose own entry keeps
  its 86400 timeout.

Installing the hooks preserves everything that is not ours, including shapes it does not
recognise, and **refuses to write** if the fingerprint of everything foreign changed in the
meantime. Verified on a real configuration file: install → uninstall → reinstall identical to
the byte, 36 foreign entries strictly preserved.

172 tests.
