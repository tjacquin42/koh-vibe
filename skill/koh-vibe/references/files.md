# Koh-Vibe files

Shapes of the files under the Koh-Vibe root (`${KOH_VIBE_HOME:-$HOME/.koh-vibe}`) that a
conversation may need to read or write. Every JSON file carries `"version": 1`, and may hold
fields not listed here: keep them as they are.

## `groups.json` — the Sessions view

```json
{
  "version": 1,
  "groups": [
    { "id": "3f2a…", "name": "VIDEO", "order": 0, "color": "purple", "soundWaiting": "Ping", "soundDone": "Glass" }
  ],
  "assignments": { "<conversation id>": "<folder id>" },
  "sessionOrder": { "<folder id>": ["<conversation id>", "…"], "": ["…"] },
  "sessionSounds": { "waiting": { "<conversation id>": "Ping" }, "done": {} },
  "artifacts": { "<artifact slug>": { "group": "<folder id>", "title": "…" } }
}
```

- `groups` — the folders. `id` is a UUID and never changes; `name` is what the user sees and
  can change. Folders are shown sorted by `order`. `color`, `soundWaiting` and `soundDone` are
  optional; colours are neutral identifiers (`blue`, `green`, `purple`…).
- `assignments` — which folder each conversation is filed in. A conversation absent from it is
  temporary. An entry pointing to a folder that no longer exists is ignored.
- `sessionOrder` — an order the user set by hand, per folder; the key `""` is the temporary
  section. Conversations it does not name come after, by status then freshness. You never need
  to touch it: a conversation filed without an order simply sorts with the others.
- `sessionSounds` — a sound for one conversation, overriding its folder's and the global one.
- `artifacts` — claude.ai artifacts filed in a folder of the Sessions view, next to its
  conversations. `title` is a snapshot, taken when it was filed.

## `rules/<folder id>.md` — a folder's rules

Markdown with a `folder:` header naming the folder. See the skill for the format. The hook
records what each conversation has already received under `rules-seen/`: never edit that.

## `rules/artifacts.md` — the artifact tidying agent's rules

Markdown with a `for:` header, one bullet per rule. See the skill. Not a folder's rules: the
prompt hook never sends it to a conversation.

## `artifact-projects.json` — the Artifacts view

```json
{
  "version": 1,
  "filed": { "<artifact slug>": "NTI", "<artifact slug>": null },
  "aliases": { "koh vibe": "koh-vibe" }
}
```

- `filed` — the project each artifact is filed under; `null` is the *Other* folder. An artifact
  absent from it is filed automatically from the project its title names, or *Other*.
- `aliases` — a folded spelling (lower case, no accents, separators as spaces) mapped to the
  project name to use. File into the spelling already in use: « nti » goes into « NTI ».

## Read only

- `sessions/<conversation id>.json` — the state of each conversation as the hooks report it
  (status, project, last activity, whether it ended).
- `events/` — the hooks' spool, drained continuously.
- `closed.json` — *Recently closed*.
- `status.json`, `usage.json` — the usage counters.
- `routines.json`, `artifacts.json` — what was last read from claude.ai.
- `settings.json` — the extension's settings, changed by the user in its Settings view.
- `bin/` — the hooks themselves, put there by **Koh-Vibe: Install hooks**.
