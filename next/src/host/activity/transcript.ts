/**
 * Reads one line of a Claude Code transcript into what the cockpit needs —
 * and nothing else. Transcripts are not a contract: every field is checked,
 * an unknown shape yields nothing rather than an exception.
 *
 * Two things the line format makes easy to get wrong, both measured on real
 * transcripts (November 2026):
 *  - an assistant message is written once per content block, and every copy
 *    carries the WHOLE message's usage — summed per line it counts several
 *    times over; it has to be keyed by the message id;
 *  - `cache_read_input_tokens` is most of the volume. V1 adds only input and
 *    output, which is why its counter reads two to six hundred times low.
 */

export interface Usage {
  input: number;
  output: number;
  /** Written to the cache this turn — new input, billed as such. */
  cacheWrite: number;
  /** Read back from the cache — the bulk of the volume. */
  cacheRead: number;
}

export type Entry =
  | { kind: 'usage'; at: number; messageId: string; model?: string; usage: Usage }
  | { kind: 'prompt'; at: number; text: string }
  | { kind: 'text'; at: number; text: string }
  /**
   * `path`: the full file path of a file tool, kept on the host side only —
   * the session sheet turns it into a path relative to the conversation's
   * directory before anything reaches the view.
   */
  | { kind: 'tool'; at: number; tool: string; target?: string; path?: string }
  | { kind: 'title'; title: string; source: 'custom' | 'ai' }
  | { kind: 'cwd'; cwd: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** What a row shows of a text: its first non-empty line, whitespace folded, cut short. */
export function firstLine(text: string, max = 140): string | undefined {
  const line = (text.split('\n').find((l) => l.trim().length > 0) ?? '').replace(/\s+/g, ' ').trim();
  if (line.length === 0) return undefined;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function basename(path: string): string {
  const parts = path.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/**
 * The few words that say what a tool call was about. A file is named by its
 * base name — a full path is noise on a row and leaks the home directory into
 * every screenshot.
 */
export function toolTarget(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const str = (k: string): string | undefined => {
    const v = input[k];
    return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
  };
  const file = str('file_path') ?? str('notebook_path') ?? str('path');
  if (file !== undefined) return basename(file);
  const text = str('description') ?? str('command') ?? str('pattern') ?? str('query') ?? str('url') ?? str('skill') ?? str('prompt') ?? str('action');
  return text === undefined ? undefined : firstLine(text, 80);
}

/** The file a tool works on, in full, when it names one. */
export function filePath(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  for (const k of ['file_path', 'notebook_path']) {
    const v = input[k];
    if (typeof v === 'string' && v.startsWith('/')) return v;
  }
  return undefined;
}

function timeOf(entry: Record<string, unknown>): number | undefined {
  const t = entry['timestamp'];
  if (typeof t !== 'string') return undefined;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * A prompt the person typed. Not a tool result, not a meta record, and not
 * what Claude Code itself injects as a user turn — task notifications, skill
 * bodies, reminders all arrive wrapped in a tag.
 */
function promptText(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const content = message['content'];
  let text: string | undefined;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block['type'] === 'tool_result') return undefined;
      if (block['type'] === 'text' && typeof block['text'] === 'string') parts.push(block['text']);
    }
    text = parts.join('\n');
  }
  if (text === undefined) return undefined;
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<')) return undefined;
  return firstLine(trimmed);
}

/** Cheap test before `JSON.parse`: most lines (request blobs, snapshots) carry nothing we read. */
const INTERESTING = /"type":"(assistant|user|custom-title|ai-title)"/;

export function parseLine(line: string): Entry[] {
  if (!INTERESTING.test(line)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(raw)) return [];
  const out: Entry[] = [];
  const type = raw['type'];
  if (type === 'custom-title' || type === 'ai-title') {
    const v = raw[type === 'custom-title' ? 'customTitle' : 'aiTitle'];
    const title = typeof v === 'string' ? firstLine(v) : undefined;
    if (title !== undefined) out.push({ kind: 'title', title, source: type === 'custom-title' ? 'custom' : 'ai' });
    return out;
  }
  const cwd = raw['cwd'];
  if (typeof cwd === 'string' && cwd.length > 0) out.push({ kind: 'cwd', cwd });
  const at = timeOf(raw);
  if (at === undefined) return out;
  const message = raw['message'];
  if (type === 'user') {
    if (raw['isMeta'] === true) return out;
    const text = promptText(message);
    if (text !== undefined) out.push({ kind: 'prompt', at, text });
    return out;
  }
  if (type !== 'assistant' || !isRecord(message)) return out;
  const id = message['id'];
  const usage = message['usage'];
  if (typeof id === 'string' && id.length > 0 && isRecord(usage)) {
    const model = message['model'];
    const u: Usage = {
      input: num(usage['input_tokens']),
      // Thinking tokens are already inside output_tokens: adding them would count twice.
      output: num(usage['output_tokens']),
      cacheWrite: num(usage['cache_creation_input_tokens']),
      cacheRead: num(usage['cache_read_input_tokens']),
    };
    const e: Entry = { kind: 'usage', at, messageId: id, usage: u };
    if (typeof model === 'string' && model.length > 0) e.model = model;
    out.push(e);
  }
  const content = message['content'];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
        const target = toolTarget(block['input']);
        const e: Entry = { kind: 'tool', at, tool: block['name'] };
        if (target !== undefined) e.target = target;
        const path = filePath(block['input']);
        if (path !== undefined) e.path = path;
        out.push(e);
      } else if (block['type'] === 'text' && typeof block['text'] === 'string') {
        const text = firstLine(block['text']);
        if (text !== undefined) out.push({ kind: 'text', at, text });
      }
    }
  }
  return out;
}

/** The timestamp of a raw line, without parsing it — for the backward scan. */
export function lineTime(line: string): number | undefined {
  const m = /"timestamp":"([^"]{10,40})"/.exec(line);
  if (m === null || m[1] === undefined) return undefined;
  const ms = Date.parse(m[1]);
  return Number.isFinite(ms) ? ms : undefined;
}
