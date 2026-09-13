import { HOOK_EVENTS, LOCAL_EVENTS, type EventName, type SpoolEvent } from './types';
import { isRecord, nonEmptyString } from '../lib/json';

const NAMES: readonly string[] = [...HOOK_EVENTS, ...LOCAL_EVENTS];

/**
 * Reduces any run of whitespace (spaces, tabs, newlines) to a single space.
 * Every value meant for display goes through here, at the boundary where it
 * enters the system — never in one of its readers: `currentAction.target`
 * and `pendingPermission.summary` (store/reduce.ts) share the same source
 * (`ev.toolTarget`), and `ev.message` also feeds that second field as a
 * fallback. Normalizing once here covers both, and any future reader,
 * without it having to think about it.
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** `nonEmptyString()` then whitespace normalization; empty after normalizing counts as absent. */
function displayText(v: unknown): string | undefined {
  const s = nonEmptyString(v);
  if (s === undefined) return undefined;
  const normalized = normalizeWhitespace(s);
  return normalized.length > 0 ? normalized : undefined;
}

function isEventName(v: string): v is EventName {
  return NAMES.includes(v);
}

// An allow list, not a block list: the real session_id values observed are
// UUIDs (hex digits and dashes). Any other character — `/`, `\`, a NUL byte,
// a space, an exotic character — is refused by construction, without having
// to enumerate them one by one. A list of forbidden characters always
// misses one (the initial M7 only blocked `/`, `\`, `.` and `..`: a NUL byte
// got through).
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

/**
 * `writeSession`/`readSession` use `session_id` as-is in a file name
 * (`sessions/<id>.json`, `.tmp-<id>-<pid>-<seq>`): an id unusable as a path
 * component produces an `ENOENT` on write — malformed data must never make a
 * downstream write throw, it must be refused here, at the boundary.
 *
 * Exported: `closed/model.ts` applies the SAME rule to the entries it reads
 * back from `closed.json`, and an id read from that file ends up on a command
 * line (`claude --resume <id>`). One rule, one place.
 */
export function isValidSessionId(id: string): boolean {
  return id !== '.' && id !== '..' && SAFE_SESSION_ID.test(id);
}

/** The first readable target of a tool call, normalized then truncated for display. */
function targetOf(toolInput: Record<string, unknown> | undefined): string | undefined {
  if (toolInput === undefined) return undefined;
  for (const key of ['file_path', 'command', 'path', 'pattern', 'url']) {
    const value = displayText(toolInput[key]);
    if (value === undefined) continue;
    return value.length > 80 ? `${value.slice(0, 79)}…` : value;
  }
  return undefined;
}

/**
 * Validates a spool file. Returns `undefined` for anything that is not
 * usable — a payload from a future version of Claude Code must never make
 * the extension crash.
 */
export function parseSpoolFile(raw: string): SpoolEvent | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(json)) return undefined;

  const event = nonEmptyString(json['event']);
  const at = typeof json['at'] === 'number' && Number.isFinite(json['at']) ? json['at'] : undefined;
  if (event === undefined || at === undefined || !isEventName(event)) return undefined;

  const payload = isRecord(json['payload']) ? json['payload'] : {};
  const sessionId = nonEmptyString(payload['session_id']);
  const cwd = nonEmptyString(payload['cwd']);
  if (sessionId === undefined || cwd === undefined || !isValidSessionId(sessionId)) return undefined;

  const toolInput = isRecord(payload['tool_input']) ? payload['tool_input'] : undefined;

  return {
    event,
    at,
    entrypoint: nonEmptyString(json['entrypoint']) ?? '',
    termProgram: nonEmptyString(json['termProgram']) ?? '',
    sessionId,
    cwd,
    transcriptPath: nonEmptyString(payload['transcript_path']),
    toolName: nonEmptyString(payload['tool_name']),
    toolTarget: targetOf(toolInput),
    message: displayText(payload['message']),
    // Present only on the calls a subagent makes. Read as plain strings and
    // never trusted further: they end up as a map key and as an icon, nothing
    // that touches the filesystem.
    agentId: nonEmptyString(payload['agent_id']),
    agentType: nonEmptyString(payload['agent_type']),
  };
}
