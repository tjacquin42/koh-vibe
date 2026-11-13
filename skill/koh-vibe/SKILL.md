---
name: koh-vibe
description: What Koh-Vibe is — the editor extension that shows the user's Claude Code sessions in a sidebar, files them into folders, gives folders rules, and lists their claude.ai artifacts and routines — and how to act on it from a conversation. Use it whenever the user mentions Koh-Vibe, its folders (« put this conversation in the VIDEO folder », « which folder am I in? », « create a folder for… »), folder rules (« add a rule to the PRO folder », « every session in this folder must… », « what are the rules of folder X? », « remove the rule about… »), a conversation that starts with « Folder rule — … » or « Règle de dossier — … », the Sessions, Artifacts, Routines or Processes views, « Recently closed », or asks why a conversation, a tab or an artifact shows where it does — even without saying « Koh-Vibe ».
---

# Koh-Vibe

Koh-Vibe is an extension for VSCode and its forks (Cursor, Windsurf, Antigravity…). It reads the
Claude Code hooks to show every running conversation in a sidebar, and lets the user organise
them. You cannot click in its views, but most of what it shows is plain files you can read and,
for a few of them, write. This skill says which, and how.

It was installed by the extension itself, and it is replaced by each new version: never edit it
to record something about the user — that belongs in your memory or in a folder rule.

## What the user sees

- **Sessions** — one row per conversation: a status dot (working, waiting for an answer, idle,
  ended), its name and what it is doing. Rows live in **folders** the user creates and colours;
  a conversation filed in no folder is **temporary**. A filed conversation never leaves the list
  on its own; a temporary one leaves after 24 h without activity, closing its tab. An ended
  conversation stays greyed in its folder (a click reopens it), or goes to **Recently closed**,
  depending on the *Persistent sessions* setting. A search icon finds a conversation, an artifact
  or a closed entry by name.
- **Artifacts** and **Routines** — the user's claude.ai artifacts, filed by project, with
  *Pinned* and *Recent* on top; and their scheduled cloud routines.
- **Processes** — what runs under each conversation (dev servers, watchers), and the orphans
  left behind.
- **Settings** — sounds, persistent/temporary behaviour, the editor tab bar.

Koh-Vibe never names a conversation: the name shown is Claude Code's own (`/rename` changes
it). If a name looks wrong, the cause is on Claude Code's side.

## Where things live

The root is `$KOH_VIBE_HOME` when set, otherwise `~/.koh-vibe`. Find it with
`echo "${KOH_VIBE_HOME:-$HOME/.koh-vibe}"`.

| File | What it holds | You may |
|---|---|---|
| `groups.json` | Folders, which conversation is in which folder, manual order, sounds, artifacts filed in folders | read; write with care (below) |
| `rules/<folder id>.md` | A folder's rules | read and write |
| `artifact-projects.json` | Which project each artifact is filed under in the Artifacts view | read; write with care |
| `settings.json` | The extension's own settings | read only — the user changes them in the view |
| `sessions/`, `events/`, `closed.json`, `status.json`, `usage.json`, `routines.json`, `artifacts.json` | State the extension writes many times a minute | read only |

The exact shapes are in [references/files.md](references/files.md). Read it before writing.

**Your own conversation id** is in `$CLAUDE_CODE_SESSION_ID`. It is the key of your row
everywhere above.

## Writing a shared file safely

Every editor window running Koh-Vibe reads and rewrites `groups.json` and
`artifact-projects.json`, merging what it finds on disk with its own change. A write of yours
survives that merge provided that you:

1. read the file right before writing, never from an earlier read;
2. change only what was asked, and keep every field you do not know as it is;
3. write a temporary file next to it, then rename it over the original — a window must never
   read a half-written file.

A missing file is an empty state: create it with `"version": 1`. Never create a folder, file a
conversation or move an artifact the user did not ask for.

## Common requests

**Which folder am I in?** Look up `assignments[$CLAUDE_CODE_SESSION_ID]` in `groups.json`, then
the folder with that `id` in `groups`. Absent: the conversation is temporary.

**File a conversation in a folder.** Find the folder by name (ignore case and accents; several
matches or none: ask, never guess), then set `assignments[<conversation id>] = <folder id>`.
To create a folder, append `{ "id": <a new UUID>, "name": …, "order": <number of folders> }` to
`groups`. To unfile, delete the key. The row moves at the next refresh of the view.

**Find a conversation.** Its id is the name of its transcript,
`~/.claude/projects/<project>/<id>.jsonl`. The user knows it by name: search the `custom-title`
and `ai-title` lines of the transcripts.

## Folder rules

A folder can carry rules: a short text Koh-Vibe adds to the context of every conversation filed
in it. The hook `~/.koh-vibe/bin/koh-vibe-rules` runs on each prompt the user sends, and prints
the folder's rules file when this conversation has not had that version yet. So:

- a rule takes effect at the **next message** of each conversation in the folder — including
  this one, if it sits in the folder it changes;
- the whole file is sent again after each change: keep it short;
- a conversation that leaves the folder is told once that the rules no longer apply.

If `~/.koh-vibe/bin/koh-vibe-rules` does not exist, the hooks predate folder rules: tell the user
to run **Koh-Vibe: Install hooks** from the command palette, or nothing you write will be read.

The file is `rules/<folder id>.md` — under the **id**, never the name, so that a renamed folder
keeps its rules:

```markdown
---
folder: VIDEO
---
- Conversations in this folder work on pixel art videos: use the create-video-pixel skill
  for anything about a video, a script to record, a thumbnail or the edit.
```

The `folder:` header tells whoever opens the file which folder it is; keep it in step if the
folder was renamed. A file with nothing but its header holds no rules.

**Adding, changing or removing a rule:**

1. **Identify the folder.** A conversation opened by the folder's *Add a rule…* menu starts with
   « Folder rule — <name> » (in the user's language, e.g. « Règle de dossier — ») and gives the
   id: use it as is. Otherwise find it by name in
   `groups.json`, as above. Never guess: a rule in the wrong folder steers conversations that
   have nothing to do with it.
2. **Read what is there** and sum it up in one sentence, so the user adds knowingly instead of
   doubling a rule.
3. **Ask for the rule** if it was not given — one open question.
4. **Write**: create `rules/` and the file if needed, with its header, then add, change or remove
   that one rule. Leave the others alone.
5. **Show the result** — the final file — and remind the user that the folder's conversations
   get it at their next message.

To show the rules, do steps 1, 2 and show the file.

**Writing a good rule.** It is read by another Claude, possibly mid-conversation, with none of
this conversation's context:

- write for that Claude, in the imperative or as a statement, in the user's words made clear;
- give the reason when it is not obvious: an understood rule handles the unforeseen case;
- name exact skills and paths, and check that a skill you cite exists — say so if it does not;
- keep it to a few bullets;
- never a secret: the file is plain text, injected into every conversation of the folder.

## What not to do

- Never write the files marked read only above: the extension rewrites them constantly, and a
  concurrent write loses data or shows a conversation in the wrong state.
- Never edit `~/.claude/settings.json` to change Koh-Vibe's hooks: **Koh-Vibe: Install hooks**
  and **Koh-Vibe: Uninstall hooks** do it, with a backup and a guard that refuses to touch any
  other tool's hooks.
- Never delete a folder: its conversations would all fall back to temporary. Point the user to
  the folder's context menu.
