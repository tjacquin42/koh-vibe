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

## [1.3.0](https://github.com/tjacquin42/koh-vibe/releases/tag/v1.3.0) — 2026-09-01

`minor` · [#25](https://github.com/tjacquin42/koh-vibe/pull/25) — A dashboard that says more at a glance: folder colours, sleep, and status dots that turn

Carries [#21](https://github.com/tjacquin42/koh-vibe/pull/21), [#23](https://github.com/tjacquin42/koh-vibe/pull/23) and [#24](https://github.com/tjacquin42/koh-vibe/pull/24).

The dashboard says more without saying it in words. A folder can be told from its neighbours
by colour, a conversation can be put aside without losing it, and a status dot now carries
what a row is asking of you — in its glow, and in a ring that turns while the work happens.

### Added

- **Ten folder colours, previewed on the folder itself.** Six became ten: `charts.*` holds
  only six hues and the palette had used every one, so indigo, cyan, lime and pink come from
  the other family every theme defines. A list of colour *names* says very little, and nothing
  in a quick pick can say more — its labels take icons but never a colour — so the folder
  shows each one as you move through the list. Closing without choosing restores what it had.
- **Putting a conversation to sleep.** A moon beside the trash closes the tab and leaves the
  row where it was, greyed, in its folder; a click reopens it. The trash is unchanged: it
  removes the row and files the conversation under "Recently closed". Sleeping rows gather in
  their own block at the bottom, separated by a blank line.
- **Copying a conversation ID**, from a right-click on any row, in either view.
- **The tab selects its row.** Clicking a Claude Code tab highlights the matching conversation
  in the dashboard, without taking the keyboard away from the editor. When two tabs share a
  title — untitled conversations all read "Claude Code" — it selects nobody rather than
  guessing wrong.
- **A setting for animated status dots**, on by default. Unchecked, the same rings are shown
  still, so nothing about a row becomes harder to read. Separate from the system's
  reduced-motion preference, which the icons honour on their own either way.

### Changed

- **A new logo**: a setting sun over a night-teal sea, replacing the island.
- **Status dots glow, and turn.** The halo is strongest on a conversation that waits for you —
  the only state that will not resolve itself — and quietest on the greys. Around it, a ring
  says where the work is: dashed and turning while running, open at one point while waiting,
  closed and still when done. A conversation that is merely idle, or asleep, carries no ring:
  nothing is running behind it.
- **The "stale" state is gone.** It marked a running conversation gone quiet after five
  minutes, and was never seen in practice. The cost of removing it is real and worth knowing:
  a conversation whose process is killed in the middle of a tool call now stays shown as
  running, because nothing else notices a row that simply goes silent.

### Fixed

- **A greyed conversation could become impossible to reopen.** The flag marking "a tab this
  window restored" was being written to the shared state, where it outlived the tab it
  described. Files already spoiled by it heal themselves on the next read.
- **Removing a row no longer brings it back.** Closing the tab is itself what makes this
  window recount its Claude tabs, which started a rescan that wrote the row back while its
  process was still registered.
- **Ticking one checkbox no longer toggles another.** Adding a third setting to a list of two
  silently sent it to the wrong place.
- **Every row no longer flashes grey** for a frame when a conversation is put to sleep.

## [1.2.1](https://github.com/tjacquin42/koh-vibe/releases/tag/v1.2.1) — 2026-08-29

`patch` · [#20](https://github.com/tjacquin42/koh-vibe/pull/20) — A listing ready for the Marketplace: a changelog that is up to date, a README that shows the panel

Carries [#18](https://github.com/tjacquin42/koh-vibe/pull/18) and
[#19](https://github.com/tjacquin42/koh-vibe/pull/19).

Nothing changes in what the extension does. This is the documentation catching up with three
releases that shipped without it, so that the listing can be published.

### Added

- **A screenshot at the top of both READMEs.** The listing described the extension without
  ever showing it. A folder is open in the capture, so what it is for is visible at a glance:
  a status dot per session, the tool a session is running, the greyed row of a conversation
  that ended, the trash that closes one.
- **Three sections in the README** — the settings and the palette commands, a statement of
  what leaves the machine (nothing but the usage call; the keychain token is never written to
  disk), and the non-affiliation with Anthropic.

### Changed

- **The changelog is three versions less late.** `v1.0.1`, `v1.1.0` and `v1.2.0` were tagged
  and released without ever being written down: `main` is protected, so the delivery posts the
  tag but cannot push the entry. All five entries are now rewritten from the bodies of the
  pull requests that delivered them.
- **The README reads the way a listing is read** — requirements first, then the Marketplace
  install, then what it shows and how to use it. *What's new* shrinks to a link to this file,
  so a release stops having to rewrite it in two languages, and the development commands move
  to CONTRIBUTING.

### Fixed

- **A test that read the wall clock** turned CI red on `expected [ 599 ] to deeply equal
  [ 600 ]`. `showBusy` waits `minMs - (now() - started)`, and the minimum-duration test left
  `now` on the real `Date.now` where its neighbour already injected one: a millisecond
  boundary falling between the start and the finally was enough. The clock is frozen, which is
  what the case was about — an instant task waits the whole floor.

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
