# Koh-Vibe

*[Version française](README.fr.md)*

Every Claude Code session you have running, in one view: across projects, across windows,
across editors — with its status, what it is doing right now, and your usage.

*Koh* means "island" in Thai. Inspired by
[open-vibe-island](https://github.com/Octane0411/open-vibe-island), which does the same thing
in the Mac notch. No code is taken from it.

**macOS only.** Chimes go through `afplay`, the usage token is read from the system keychain,
and the hook bridges are zsh scripts.

## What it shows

- **Live sessions**, sorted by what wants your attention: the ones waiting for you first, then
  the ones working, then the ones that just finished.
- **A status dot** per session — one glyph, five colours — next to the project, the branch and
  the tool currently running.
- **Ended conversations** stay in the list, greyed out and in their folder, for as long as
  *Persistent sessions* is on in the settings (it is by default) — the twenty most recent.
  Turn it off and closing a tab takes the row away; *Recently closed*, a view of its own,
  then keeps the ten conversations that ended most recently.
- **Close a conversation** with the trash icon that appears when you hover a live row. It
  closes its Claude Code tab, which ends the conversation: the row greys out, or leaves for
  *Recently closed*, depending on the setting. When no tab is found — a conversation running
  in a terminal, in the Claude desktop app, or in a project no window has open — the row is
  simply removed from the list. On an ended row, the icon removes it for good.
- **Your usage** over five hours and seven days — and per model, when your plan counts one
  apart — with the time until it resets.
- **One click** opens or resumes a session's window, wherever it lives — a closed one included.

## Install

The extension is not published on the marketplace; it installs from a locally built package.

```bash
pnpm install
pnpm package
code --install-extension koh-vibe-0.1.0.vsix --force
```

`pnpm package` compiles before packaging, so the `.vsix` always holds the code you just wrote.

VSCode forks expose the same command under their own binary name (usually installable from
their palette via *Install 'code' command in PATH*). The same `.vsix` works there unchanged.

**Quit the editor fully after installing** — not just a window reload. Views and icons are
read at startup.

### Install the hooks

Nothing appears until Claude Code starts dropping its events. Open the Koh-Vibe view and click
*Hooks not installed*, or run **Koh-Vibe: Install hooks** from the palette.

The script adds eight hooks to `~/.claude/settings.json`, **backs the file up before touching
it**, and refuses to write if its fingerprint changed in the meantime. Hooks and a status line
you already had are preserved: Koh-Vibe chains onto the end, it replaces nothing.
**Koh-Vibe: Uninstall hooks** undoes exactly that.

## Using it

**Filing.** Create folders, drag sessions into them, give them a colour. The order inside a
folder is set by hand and stays put: a session opened later lands at the end without
disturbing what you placed. The folders themselves are dragged the same way — drop one onto
another to put it in front, or onto *Unfiled* to send it to the end.

**Chimes.** One when a session starts waiting for you, another when it finishes. Three levels,
most specific first: a conversation's sound beats its folder's, which beats the global
setting. "None" is a chosen silence rather than an absent choice, so it does not fall through
to the level above.

The macOS sounds are the baseline. Koh-Vibe offers to add a library of a hundred short
interface sounds ([Kenney](https://kenney.nl/assets/interface-sounds), CC0), downloaded once
and kept in its own folder — never in `~/Library/Sounds`, whose listing also feeds the system
Sound panel. The *Sound library* row in the settings installs and removes it.

Two of its sounds travel inside the package, renamed after what they announce: **Attente**,
when a session starts waiting for you, and **Fin**, when it finishes. A fresh install starts
on those two, so the dashboard chimes from the first launch, library or no library. They are
a default, not a policy: a sound already chosen — a chosen silence included — stays as it is,
and an update never puts them back.

In the picker, the arrow keys play each sound; **→** replays the highlighted one.

**Removing.** Right-click a session → *Remove from the list*. Nothing is stopped: Claude Code
runs in its own terminal, and a session still alive reappears on its next event.

**Persistent sessions.** The first row of the settings, a checkbox, decides what closing a tab
does to its row. Checked — the default — the conversation stays in the list, greyed out, in
its folder, with a muted dot and the time it closed; the twenty most recent are kept, and
*Remove from the list* takes one away for good. Unchecked, closing the tab removes the row,
and unchecking also removes the rows already ended. Hover the row for the same explanation.

**Reopening.** One click on an ended conversation — a greyed row, or an entry of *Recently
closed* — brings it back: in the editor tab it ran in, or a fresh terminal on its folder,
whichever it came from.

## Where the data lives

Everything sits under `~/.koh-vibe/`:

| | |
|---|---|
| `bin/` | the bridge and the status-line wrapper, copied when the hooks are installed |
| `events/` | the spool: one file per event, consumed then deleted |
| `events/rejected/` | what could not be read, kept rather than dropped |
| `sessions/` | the reduced state, one file per session |
| `requests/` | focus, reopen and close requests, from one window to another |
| `backups/` | copies of `settings.json` taken before each hook install |
| `groups.json` | folders, their colours, the chosen order and the sounds |
| `closed.json` | the ten most recently closed conversations |
| `settings.json` | global sounds, volume, and whether sessions persist |
| `usage.json` | the last usage reading, cached |
| `status.json` | the last status-line snapshot |
| `sounds/` | the library, if you installed it |

These files are **shared across every window and every editor** on the machine: a folder made
on one side shows up on the other, and a sound chosen once applies everywhere. Uninstalling
the extension does not erase them; deleting the directory is enough to start over.

## How it works

Claude Code's hooks call a **shell bridge that parses nothing**: it copies what it receives
into the spool, never writes to standard output, and always exits successfully. A bridge that
parsed JSON could fail, and a failing hook disturbs the session it observes — the only
acceptable behaviour is to break nothing, even at the cost of losing an event.

Each window watches the spool on its own, reduces the events into state, and displays it. No
locks: shared files are merged three ways (the state read, ours, and the freshest one re-read
just before writing), so two windows filing at the same time do not erase each other.

A conversation leaves the list when it ends, when you close it, or when you remove it —
never because it went quiet: a tab you left open for a day is still a conversation.
**Refresh** reads Claude Code's own registry of running processes (`~/.claude/sessions/`)
and brings back every live conversation the list has lost, in the folder it was filed in.
The same pass runs when the window opens, and a few seconds after a conversation vanishes
while its process still runs — the same conversation open in two editors, one of them
quitting — with a spinner in place of the button while it does. Tabs the editor restored
but you have not opened since show as « tab not started »: a click wakes them. « Remove
from the list » hides a conversation until its next activity.

Usage comes from Anthropic's API, called at most once every five minutes and cached in a
shared file — otherwise every window would fetch exactly the same thing. The OAuth token is
read from the system keychain, never logged and never written to disk.

## Contributing

Outside contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
pnpm install
pnpm build       # compiles to out/, and stamps the build from the latest tag
pnpm test        # builds, then runs 663 tests without an extension host
pnpm test:watch  # the same tests, without rebuilding on every run
pnpm typecheck   # types across src AND test
pnpm package     # produces the .vsix
```

`pnpm test` builds first because the end-to-end test runs `scripts/install-hooks.cjs`, which
loads the compiled installer. That dependency used to be invisible: it held on a machine that
had built once, and failed on a fresh clone.

Tests do not start VSCode: `vscode` resolves to a stub (`test/stubs/vscode.ts`), which makes
the tree, the commands and the bridge testable in milliseconds. The type checker, however,
works against the real API — a stub that drifted from its signatures would prove nothing.

`scripts/make-icons.cjs` regenerates both icons from the point table it contains: that table
is the source of the drawing.

Versioning is described in [CLAUDE.md](CLAUDE.md) — one pull request merged into `main` is one
version, and the delivery workflow posts it on its own.

## Licence

[MIT](LICENSE).
