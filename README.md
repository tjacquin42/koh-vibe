# Koh-Vibe

*[Version française](README.fr.md)*

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/tjacquin42.koh-vibe?label=marketplace)](https://marketplace.visualstudio.com/items?itemName=tjacquin42.koh-vibe)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/tjacquin42.koh-vibe)](https://marketplace.visualstudio.com/items?itemName=tjacquin42.koh-vibe)
[![Licence](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

Every Claude Code session you have running, in one view: across projects, across windows,
across editors — with its status, what it is doing right now, and your usage.

> **macOS only.** Chimes go through `afplay`, the usage token is read from the system
> keychain, and the hook bridges are zsh scripts. Nothing here pretends to work elsewhere.

## Requirements

- **macOS**, for the reasons above.
- **[Claude Code](https://claude.com/claude-code)**, used from this machine. Koh-Vibe watches
  the sessions you run; it starts one only when you ask it to.
- **VSCode 1.94** or newer, or a fork that follows it — Cursor and Antigravity are what it is
  used with day to day.
- **Claude Code's hooks**, installed in one click from the view. Nothing appears in the list
  until they are — see [Install the hooks](#install-the-hooks).

## Install

Search **Koh-Vibe** in the Extensions view, or run:

```
ext install tjacquin42.koh-vibe
```

Then reload the window, open the Koh-Vibe view in the activity bar, and install the hooks.

VSCode forks — Cursor, Windsurf, VSCodium — do not reach the Microsoft marketplace. Build the
package yourself for those; it is one command, [below](#from-source).

### Install the hooks

Nothing appears until Claude Code starts dropping its events. Open the Koh-Vibe view and click
*Hooks not installed*, or run **Koh-Vibe: Install hooks** from the palette.

The script adds eight hooks to `~/.claude/settings.json`, **backs the file up before touching
it**, and refuses to write if its fingerprint changed in the meantime. Hooks and a status line
you already had are preserved: Koh-Vibe chains onto the end, it replaces nothing.
**Koh-Vibe: Uninstall hooks** undoes exactly that.

### From source

From the integrated terminal of the editor you want it in:

```bash
git clone https://github.com/tjacquin42/koh-vibe.git
cd koh-vibe
pnpm install
sh install.sh
```

`install.sh` builds, packages under a throwaway version number and installs into the editor
its terminal belongs to — VSCode, Cursor or Antigravity, whichever runs it. Then reload the
window (*Developer: Reload Window*). The number comes from the clock so that every install
lands in a fresh directory: the one in `package.json` only moves at release time, and
reinstalling under the same number leaves the editor serving what it already had.

## What it shows

- **Live sessions**, sorted by what wants your attention: the ones waiting for you first, then
  the ones working, then the ones that just finished.
- **A status dot** per session — one glyph, five colours — next to the project, the branch and
  the tool currently running. The row is named as the tab is: the title you gave it, else the
  one Claude generated, else the last prompt.
- **Ended conversations** stay in the list, greyed out and in their folder, for as long as
  *Persistent sessions* is on in the settings (it is by default). Turn it off and closing a
  tab takes the row away instead. *Recently closed*, a view of its own, keeps the ten
  conversations that ended most recently either way.
- **Temporary sessions** is where a conversation lands until you drag it into a folder. Left
  there for 24 hours without activity, it leaves the list — a setting turns that off.
- **Close a conversation** with the trash icon that appears when you hover a live row. It
  closes its Claude Code tab and removes the row — the conversation goes to *Recently
  closed* — in one click, whatever *Persistent sessions* says: that setting is for the tabs
  you close yourself. A restored tab is closed in place, without being opened. When no tab is
  found — a conversation running in a terminal, in the Claude desktop app, or in a project no
  window has open — the row is simply removed from the list. On a greyed row, the icon removes
  it for good. A conversation that ends before its first message — Claude Code starts one for
  every panel it opens — leaves no row and no history: there is nothing to come back to.
- **Your usage** over five hours and seven days — and per model, when your plan counts one
  apart — with the time until it resets.
- **One click** opens or resumes a session's window, wherever it lives — a closed one included.

## Using it

**Filing.** Create folders, drag sessions into them, give them a colour. The order inside a
folder is set by hand and stays put: a session opened later lands at the end without
disturbing what you placed. The folders themselves are dragged the same way — drop one onto
another to put it in front, or onto *Temporary sessions* to send it to the end.

**New session.** The **+** button in the view title opens a new Claude Code tab — a fresh
conversation in the window's folder. Hover a folder: the same **+** appears at the right of
its row (right-click offers it too, as *New session here*) and files the conversation in that
folder as soon as it shows up, so it is not a temporary one.

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
its folder, with a muted dot and the time it closed; the fifty most recent are kept, and
*Remove from the list* takes one away for good. Unchecked, closing the tab removes the row
instead; the rows already greyed stay either way. Hover the row for the same explanation.

**Temporary sessions.** The second checkbox. A conversation filed in no folder is temporary:
after 24 hours without activity it leaves the list — hidden, not forgotten, so any activity in
it brings it back, and filing it in a folder keeps it for good. Unchecked, temporary
conversations stay until you remove them.

**Reopening.** One click on an ended conversation — a greyed row, or an entry of *Recently
closed* — brings it back: in the editor tab it ran in, or a fresh terminal on its folder,
whichever it came from. The editor tab only when Claude Code will find the conversation from
this window — its transcript under the window's own project, and not hidden from its session
list; otherwise a terminal resumes it, which works from anywhere. A restored tab nobody has
opened yet is simply brought to the front, never opened a second time.
While it comes back, the row spins in place of its dot — a few seconds pass between the click
and the conversation showing up, during which nothing else moves — and takes no second click,
which would open a second tab. The spinner clears when the conversation is open again, or
after thirty seconds without it.

## Settings and commands

Koh-Vibe's settings live in its own **Settings** view, at the bottom of the panel, not in the
editor's settings: two checkboxes — *Persistent sessions* and *Temporary sessions* — the
global chime for each event, the volume, and the sound library. Folders and conversations
override the chimes from their own right-click menu.

From the command palette, under **Koh-Vibe**:

| Command | What it does |
|---|---|
| *Install hooks* / *Uninstall hooks* | adds Koh-Vibe's hooks to `~/.claude/settings.json`, or takes them back out |
| *Refresh* | re-reads Claude Code's registry and brings back every live conversation the list lost |
| *New session* | opens a new Claude Code tab, filed in the current window's folder |
| *New folder* | creates a folder |
| *Sound for an event* · *Chime volume* | the global chimes |
| *Install the sound library* / *Remove the sound library* | the hundred Kenney sounds |
| *Refresh usage* | forces a usage reading, which is otherwise cached for five minutes |

The rest — reopening, closing, renaming, colouring, per-folder and per-conversation sounds —
is on the right-click menu of the row it applies to.

## Your data, and what leaves the machine

**Nothing is sent anywhere, and there is no telemetry.** The one network call Koh-Vibe makes
is to Anthropic, for your usage figures, at most once every five minutes. The OAuth token it
needs is read from the system keychain — never logged, never written to disk. No prompt, no
transcript and no path ever leaves the machine.

Everything else sits under `~/.koh-vibe/`:

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
| `settings.json` | global sounds, volume, and the two list settings |
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
but you have not opened since are listed like any idle session — the tab is open, that is
what counts. The editor resolves only the active tab, so no Claude Code process runs behind
the others until they are shown: a click brings the tab to the front, and Claude Code resumes
it. *Remove from the list* hides a conversation until its next activity.

## What's new

**1.2.0** keeps every conversation: ended ones stay greyed in their folder, reopening brings
back that very conversation rather than a blank one, unfiled ones are *temporary* until you
file them, the trash closes tab and row in one click, and a **+** starts a new session from
the dashboard. Nothing is forgotten for going quiet any more.

Every version, and what it changed, is in the [changelog](CHANGELOG.md).

## Contributing

Outside contributions are welcome — the flow, the commands and what the review looks at are
in [CONTRIBUTING.md](CONTRIBUTING.md). Versioning is described in [CLAUDE.md](CLAUDE.md): one
pull request merged into `main` is one version, and the delivery workflow posts it on its own.

## Credits

*Koh* means "island" in Thai. Inspired by
[open-vibe-island](https://github.com/Octane0411/open-vibe-island), which does the same thing
in the Mac notch. No code is taken from it.

Koh-Vibe is an independent project. It is not affiliated with, endorsed by, or sponsored by
Anthropic.

## Licence

[MIT](LICENSE).
