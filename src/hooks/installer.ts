import { HOOK_EVENTS } from '../events/types';
import { isRecord } from '../lib/json';

/** Marker that makes our entries recognizable: our bridge's file name. */
export const KOH_MARKER = 'koh-vibe-bridge';

/**
 * The old name, before the extension became Koh-Vibe.
 *
 * It MUST stay recognized: entries dropped by a previous version still
 * live in the settings.json of those who had it installed. No longer
 * seeing them would not erase them — they would become orphans that no
 * uninstall removes, and a reinstall would drop a second set of hooks
 * alongside them. Every event would then leave twice into the spool.
 *
 * Recognized on uninstall and on cleanup, never written: a fresh install
 * only drops the current name.
 */
const KOH_LEGACY_MARKER = 'koh-claude-bridge';

function isMarker(path: string, marker: string): boolean {
  return path === marker || path.endsWith(`/${marker}`);
}

interface HookCommand {
  type: 'command';
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookCommand[];
}

/** A recognized matcher entry: an object whose `hooks` is an array. */
function isMatcher(v: unknown): v is HookMatcher {
  return isRecord(v) && Array.isArray(v['hooks']);
}

// The exact shape, and strictly that one, that `installHooks` writes for a
// given `bridgePath` and `event` — see the construction of `command` below.
// Capturing the path once and finding it again through a backreference
// (`\1`) guarantees that both occurrences are identical, as in the
// original template.
const OUR_COMMAND_RE = new RegExp(
  `^/bin/sh -c '\\[ -x "([^"]+)" \\] && "\\1" (?:${HOOK_EVENTS.join('|')}); exit 0'$`,
);

/**
 * A command is ours only if it matches, character for character, the
 * template we write ourselves — never if it merely contains it or
 * mentions it in passing. A substring test would classify as ours a
 * foreign command that wraps our bridge (`sh -c 'something-else &&
 * ~/.koh-vibe/bin/koh-vibe-bridge'`): it would then get removed by
 * `installHooks`/`uninstallHooks`, and be invisible to
 * `foreignFingerprint` since it shares this same predicate — both
 * safeguards would fall together. Recognizing the exact template closes
 * both at once.
 *
 * `uninstallHooks` does not receive a `bridgePath`: recognizing the
 * structural template (rather than comparing against a string built with
 * a `bridgePath` we don't have) is what lets this function work without
 * that argument.
 */
function isOurs(h: unknown): boolean {
  if (!isRecord(h) || typeof h['command'] !== 'string') return false;
  const match = OUR_COMMAND_RE.exec(h['command']);
  if (!match) return false;
  const bridgePath = match[1];
  if (bridgePath === undefined) return false;
  return isMarker(bridgePath, KOH_MARKER) || isMarker(bridgePath, KOH_LEGACY_MARKER);
}

/**
 * Removes our commands from a recognized matcher entry. Any value that is
 * not a recognized matcher entry (unexpected shape: `hooks` missing, not
 * an array, an entry that is not even an object…) is not ours — it passes
 * through intact, in its place, rather than silently disappearing.
 */
function stripOurs(item: unknown): unknown[] {
  if (!isMatcher(item)) return [item];
  const hooksLeft = item.hooks.filter((h) => !isOurs(h));
  return hooksLeft.length > 0 ? [{ ...item, hooks: hooksLeft }] : [];
}

/**
 * Adds our entries without touching the others. Our command never has a
 * `timeout`: a blocking `PermissionRequest` hook would decide in the
 * user's place and would compete with Vibe Island's own.
 *
 * If an event's existing value is not an array (a shape we do not
 * recognize), we do not replace it: there is no way to add our entry to
 * it without overwriting data that is not ours, so we leave it as is and
 * install nothing for that specific event.
 */
export function installHooks(settings: unknown, bridgePath: string): unknown {
  const root = isRecord(settings) ? { ...settings } : {};
  const hooks = isRecord(root['hooks']) ? { ...root['hooks'] } : {};

  for (const event of HOOK_EVENTS) {
    const value = hooks[event];
    if (value !== undefined && !Array.isArray(value)) continue;

    const list = Array.isArray(value) ? value : [];
    const command = `/bin/sh -c '[ -x "${bridgePath}" ] && "${bridgePath}" ${event}; exit 0'`;
    const ourEntry: HookMatcher = { matcher: '*', hooks: [{ type: 'command', command }] };
    hooks[event] = [...list.flatMap(stripOurs), ourEntry];
  }

  root['hooks'] = hooks;
  return root;
}

/**
 * Removes our entries without touching the others. An event whose value
 * is not an array (a shape we do not recognize) is carried over as is. An
 * event that, once our entries are removed, no longer contains anything
 * at all — neither ours nor anyone else's — is omitted so as not to leave
 * a stray empty array behind.
 */
export function uninstallHooks(settings: unknown): unknown {
  const root = isRecord(settings) ? { ...settings } : {};
  if (!isRecord(root['hooks'])) return root;
  const hooks: Record<string, unknown> = {};

  for (const [event, value] of Object.entries(root['hooks'])) {
    if (!Array.isArray(value)) {
      hooks[event] = value;
      continue;
    }
    const kept = value.flatMap(stripOurs);
    if (kept.length > 0) hooks[event] = kept;
  }

  // Nothing ours or anyone else's: do not leave a residual `hooks: {}`
  // key in a file that is not ours.
  if (Object.keys(hooks).length > 0) {
    root['hooks'] = hooks;
  } else {
    delete root['hooks'];
  }
  return root;
}

export function countKohEntries(settings: unknown): number {
  if (!isRecord(settings) || !isRecord(settings['hooks'])) return 0;
  let n = 0;
  for (const value of Object.values(settings['hooks'])) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (isMatcher(entry)) n += entry.hooks.filter(isOurs).length;
    }
  }
  return n;
}

/**
 * A fingerprint of everything in the `hooks` tree that is not ours —
 * including shapes we do not know how to classify, serialized as is.
 * Serves as a safeguard on the installer script's side: if this
 * fingerprint changes after a transformation, something that is not ours
 * has disappeared, moved, or been replaced by something else. A count
 * cannot prove conservation — two trees where a foreign command simply
 * changed event, or was lost at the same time another one appeared, can
 * share the same count; the fingerprint, on the other hand, necessarily
 * differs since each element is qualified by its position.
 *
 * Each element is identified by its ancestry in names — `hooks` → event
 * name → the value of the `matcher` field of the object that holds it,
 * when it has one — never by an array index: an index legitimately moves
 * when we insert our own entry, an event name or a matcher pattern does
 * not.
 *
 * The ancestry is encoded as a **sequence of segments**, serialized in a
 * single `JSON.stringify` with the value as the last element — never by
 * concatenation with a separator. A concatenation `"hooks." + event + "."
 * + matcher` confuses `event = "PreToolUse.Bash"` with `event =
 * "PreToolUse", matcher = "Bash.foo"` as soon as either one contains the
 * separator; two distinct array segments always serialize differently, no
 * matter their content.
 *
 * Deliberately walked independently of `stripOurs`/`isMatcher`: if the
 * fingerprint read the structure the same way as the transformation it is
 * watching over, a shape that this reading cannot see would be missing
 * from both sides and the safeguard would let through exactly the kind of
 * loss it is meant to catch.
 *
 * Accepted residues, documented rather than hidden:
 * - Two foreign commands that only swap their order inside the same
 *   matcher (so under the same ancestry key) remain indistinguishable,
 *   the fingerprint being sorted to ignore the enumeration order of
 *   object keys.
 * - Two matcher blocks that share the same pattern within the same event
 *   also share the same ancestry key: the commands all remain present
 *   and qualified by the trigger condition they share, but one cannot
 *   tell precisely which of the two blocks each one comes from.
 */
export function foreignFingerprint(settings: unknown): string[] {
  if (!isRecord(settings) || !isRecord(settings['hooks'])) return [];
  const out: string[] = [];

  const record = (path: readonly string[], value: unknown): void => {
    out.push(JSON.stringify([...path, value]));
  };

  const walkCommandList = (path: readonly string[], list: unknown[]): void => {
    for (const item of list) {
      if (isOurs(item)) continue;
      record(path, item);
    }
  };

  const walkMatcherArray = (path: readonly string[], list: unknown[]): void => {
    for (const item of list) {
      const itemPath =
        isRecord(item) && typeof item['matcher'] === 'string' ? [...path, item['matcher']] : path;
      if (isRecord(item) && Array.isArray(item['hooks'])) {
        walkCommandList(itemPath, item['hooks']);
      } else {
        record(itemPath, item);
      }
    }
  };

  for (const [event, value] of Object.entries(settings['hooks'])) {
    const path = ['hooks', event];
    if (Array.isArray(value)) {
      walkMatcherArray(path, value);
    } else {
      record(path, value);
    }
  }

  return out.sort();
}

/** Marker that makes our statusline entry recognizable, like KOH_MARKER for hooks. */
const KOH_STATUSLINE_MARKER = 'koh-vibe-statusline';

// The exact template we write, and only that one. The bridge's path is
// captured once and found again through a backreference: the two
// occurrences cannot diverge. The second group is the previous command,
// base64-encoded — empty if the spot was free.
const OUR_STATUSLINE_RE = new RegExp(
  `^/bin/sh -c '\\[ -x "([^"]+)" \\] && exec "\\1" "([A-Za-z0-9+/=]*)"; exec /bin/sh -c "\\$\\(printf %s "\\2" \\| /usr/bin/base64 -d\\)"'$`,
);

function statusLineCommandOf(settings: unknown): string | undefined {
  if (!isRecord(settings)) return undefined;
  const line = settings['statusLine'];
  if (!isRecord(line)) return undefined;
  const command = line['command'];
  return typeof command === 'string' ? command : undefined;
}

/**
 * What our statusline entry wraps: the command that occupied the spot
 * before us, or `undefined` if the entry is not ours.
 *
 * Recognition by exact template, never by substring — same reason as
 * `isOurs`: a foreign command that MENTIONED our bridge would otherwise
 * be classified as ours, then removed on uninstall.
 */
export function wrappedStatusLine(settings: unknown): string | undefined {
  const command = statusLineCommandOf(settings);
  if (command === undefined) return undefined;
  const match = OUR_STATUSLINE_RE.exec(command);
  if (!match) return undefined;
  const bridge = match[1];
  if (bridge === undefined || !(bridge === KOH_STATUSLINE_MARKER || bridge.endsWith(`/${KOH_STATUSLINE_MARKER}`))) {
    return undefined;
  }
  const encoded = match[2] ?? '';
  return encoded.length === 0 ? '' : Buffer.from(encoded, 'base64').toString('utf8');
}

/**
 * Installs our statusline bridge by DELEGATING to whatever was there.
 *
 * Claude Code offers only one statusline slot. Taking it without handing
 * back control would cut off the tool that occupied it — Vibe Island reads
 * its usage limits there, and that is where the data we display comes
 * from. The previous command is therefore base64-encoded and passed as an
 * argument: the encoding avoids any extra level of quoting in a string
 * that already crosses JSON and then two shells.
 *
 * The second half of the command is a fallback: if our bridge has
 * disappeared (package uninstalled, state folder erased), the previous
 * command still runs. Losing our measurement is acceptable; silently
 * breaking someone else's statusline is not.
 *
 * Reinstalling over our own entry does not nest it: the wrapped command
 * is the one we were already wrapping.
 */
export function installStatusLine(settings: unknown, bridgePath: string): unknown {
  const root = isRecord(settings) ? { ...settings } : {};
  const already = wrappedStatusLine(root);
  const previous = already ?? statusLineCommandOf(root) ?? '';
  const encoded = Buffer.from(previous, 'utf8').toString('base64');
  const command =
    `/bin/sh -c '[ -x "${bridgePath}" ] && exec "${bridgePath}" "${encoded}"; ` +
    `exec /bin/sh -c "$(printf %s "${encoded}" | /usr/bin/base64 -d)"'`;
  root['statusLine'] = { type: 'command', command };
  return root;
}

/**
 * Gives the spot back to whoever occupied it. An entry that is not ours
 * is not touched. If we were not wrapping anything, the key disappears
 * entirely rather than leaving an empty statusline behind us.
 */
export function uninstallStatusLine(settings: unknown): unknown {
  const root = isRecord(settings) ? { ...settings } : {};
  const previous = wrappedStatusLine(root);
  if (previous === undefined) return root;
  if (previous.length === 0) {
    delete root['statusLine'];
    return root;
  }
  root['statusLine'] = { type: 'command', command: previous };
  return root;
}
