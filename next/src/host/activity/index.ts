/**
 * What the Claude Code transcripts say about the last hours — READ ONLY.
 *
 * The cockpit's wall, feed, timeline and detailed usage all come from here.
 * The spool cannot serve them: V1 drains it as it goes, and the V2 must not
 * touch it while V1 owns it. The transcripts are Claude Code's own record,
 * written whatever extension is installed, and they hold what the spool
 * never had: the cache and the subagents.
 *
 * Cost is the whole design. A busy session writes a 100 MB transcript, and
 * most of it is older than the window. So a file seen for the first time is
 * read BACKWARDS from its end until a line older than the window turns up;
 * after that only what was appended is read. Lines are tested with a cheap
 * pattern before any `JSON.parse` (transcript.ts).
 */
import { open, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { lineTime, parseLine, type Entry, type Usage } from './transcript';

/** The rolling window the cockpit looks over. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;
/** How many feed items a transcript keeps — the feed shows the latest few hundred across all of them. */
const MAX_ITEMS = 300;
const CHUNK = 1 << 20;

export type Item = Extract<Entry, { kind: 'prompt' | 'text' | 'tool' }>;

interface UsageRecord {
  at: number;
  model?: string;
  usage: Usage;
}

export interface FileState {
  path: string;
  /** The conversation this transcript belongs to: its own id, or its parent's for a subagent. */
  sessionId: string;
  subagent: boolean;
  offset: number;
  size: number;
  mtimeMs: number;
  cwd?: string;
  title?: string;
  titleSource?: 'custom' | 'ai';
  /** Keyed by message id: one message, one count, however many lines repeat it. */
  usage: Map<string, UsageRecord>;
  items: Item[];
}

export interface FsDeps {
  listProjectDirs(root: string): Promise<string[]>;
  listJsonl(dir: string): Promise<string[]>;
  stat(path: string): Promise<{ size: number; mtimeMs: number } | undefined>;
  read(path: string, start: number, length: number): Promise<Buffer>;
}

export const nodeFs: FsDeps = {
  async listProjectDirs(root) {
    try {
      const names = await readdir(root, { withFileTypes: true });
      return names.filter((d) => d.isDirectory()).map((d) => join(root, d.name));
    } catch {
      return [];
    }
  },
  async listJsonl(dir) {
    try {
      return (await readdir(dir)).filter((n) => n.endsWith('.jsonl')).map((n) => join(dir, n));
    } catch {
      return [];
    }
  },
  async stat(path) {
    try {
      const s = await stat(path);
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return undefined;
    }
  },
  async read(path, start, length) {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
};

/** `<project>/<id>.jsonl` is a conversation; `<project>/<id>/subagents/agent-*.jsonl` belongs to `<id>`. */
export function sessionOfPath(path: string): { sessionId: string; subagent: boolean } {
  const dir = dirname(path);
  if (basename(dir) === 'subagents') return { sessionId: basename(dirname(dir)), subagent: true };
  return { sessionId: basename(path, '.jsonl'), subagent: false };
}

/**
 * The byte offset of the first line at or after `since`, reading from the end.
 *
 * Lines are in time order, so the walk stops at the first stamped line older
 * than the window. Unstamped lines (titles, snapshots) do not stop it — they
 * sit between stamped ones and carry no time of their own. Returns `size`
 * when nothing in the file is recent, 0 when everything is.
 */
export async function startOffset(fs: FsDeps, path: string, size: number, since: number, chunkSize = CHUNK): Promise<number> {
  let end = size;
  // Bytes of a line cut by the previous chunk boundary, waiting for their start.
  let carry = Buffer.alloc(0);
  let candidate = size;
  while (end > 0) {
    const start = Math.max(0, end - chunkSize);
    const chunk = Buffer.concat([await fs.read(path, start, end - start), carry]);
    // Everything after the first newline is made of whole lines (unless start is 0).
    const firstBreak = start === 0 ? -1 : chunk.indexOf(0x0a);
    const body = firstBreak < 0 ? chunk : chunk.subarray(firstBreak + 1);
    const bodyStart = start + (firstBreak < 0 ? 0 : firstBreak + 1);
    carry = firstBreak < 0 ? Buffer.alloc(0) : chunk.subarray(0, firstBreak + 1);
    // Walk this body's lines from last to first.
    let lineEnd = body.length;
    while (lineEnd > 0) {
      // A negative offset would make lastIndexOf search from the END of the buffer.
      const lineStart = lineEnd < 2 ? 0 : body.lastIndexOf(0x0a, lineEnd - 2) + 1;
      const t = lineTime(body.subarray(lineStart, lineEnd).toString('utf8'));
      if (t !== undefined) {
        if (t < since) return candidate;
        candidate = bodyStart + lineStart;
      }
      lineEnd = lineStart;
    }
    end = start;
  }
  return 0;
}

function applyEntries(state: FileState, entries: readonly Entry[], since: number): void {
  for (const e of entries) {
    switch (e.kind) {
      case 'cwd':
        state.cwd = e.cwd;
        break;
      case 'title':
        // A title the person chose always wins over the one Claude generated.
        if (e.source === 'custom' || state.titleSource !== 'custom') {
          state.title = e.title;
          state.titleSource = e.source;
        }
        break;
      case 'usage':
        if (e.at >= since) state.usage.set(e.messageId, e.model === undefined ? { at: e.at, usage: e.usage } : { at: e.at, model: e.model, usage: e.usage });
        break;
      default:
        if (e.at >= since) state.items.push(e);
    }
  }
  if (state.items.length > MAX_ITEMS) state.items.splice(0, state.items.length - MAX_ITEMS);
}

/** Reads `[state.offset, size)` and applies its whole lines; a half-written last line waits for the next pass. */
async function readForward(fs: FsDeps, state: FileState, size: number, since: number): Promise<void> {
  while (state.offset < size) {
    const length = Math.min(CHUNK * 8, size - state.offset);
    const buf = await fs.read(state.path, state.offset, length);
    if (buf.length === 0) return;
    const lastBreak = buf.lastIndexOf(0x0a);
    if (lastBreak < 0) {
      // One line longer than the read: take a bigger bite next time round, or stop at the file's end.
      if (length === size - state.offset) return;
      const whole = await fs.read(state.path, state.offset, size - state.offset);
      const br = whole.lastIndexOf(0x0a);
      if (br < 0) return;
      for (const line of whole.subarray(0, br).toString('utf8').split('\n')) applyEntries(state, parseLine(line), since);
      state.offset += br + 1;
      continue;
    }
    for (const line of buf.subarray(0, lastBreak).toString('utf8').split('\n')) applyEntries(state, parseLine(line), since);
    state.offset += lastBreak + 1;
  }
}

export class ActivityIndex {
  private readonly files = new Map<string, FileState>();

  constructor(
    private readonly projectsDir: string,
    private readonly fs: FsDeps = nodeFs,
    private readonly windowMs: number = WINDOW_MS,
  ) {}

  /** Every transcript touched within the window, read up to its current end. */
  async refresh(now: number): Promise<void> {
    const since = now - this.windowMs;
    const dirs = await this.fs.listProjectDirs(this.projectsDir);
    const recent: { path: string; size: number; mtimeMs: number }[] = [];
    const statRecent = async (path: string): Promise<boolean> => {
      const s = await this.fs.stat(path);
      if (s === undefined || s.mtimeMs < since) return false;
      recent.push({ path, ...s });
      return true;
    };
    for (const dir of dirs) {
      for (const p of await this.fs.listJsonl(dir)) {
        // Subagents live under the parent's id, and a parent writes when it
        // starts one: only a parent touched within the window is searched.
        if (!(await statRecent(p))) continue;
        for (const sub of await this.fs.listJsonl(join(dir, basename(p, '.jsonl'), 'subagents'))) await statRecent(sub);
      }
    }
    const seen = new Set<string>();
    for (const s of recent) {
      const path = s.path;
      seen.add(path);
      let state = this.files.get(path);
      if (state !== undefined && (s.size < state.offset || s.size < state.size)) state = undefined; // replaced or truncated
      if (state === undefined) {
        const who = sessionOfPath(path);
        state = { path, ...who, offset: await startOffset(this.fs, path, s.size, since), size: s.size, mtimeMs: s.mtimeMs, usage: new Map(), items: [] };
        // The title and cwd sit wherever Claude Code last wrote them, often before the window.
        await this.readHeader(state);
        this.files.set(path, state);
      }
      if (s.size > state.offset) await readForward(this.fs, state, s.size, since);
      state.size = s.size;
      state.mtimeMs = s.mtimeMs;
    }
    for (const [path, state] of this.files) {
      if (!seen.has(path)) {
        this.files.delete(path);
        continue;
      }
      for (const [id, u] of state.usage) if (u.at < since) state.usage.delete(id);
      const firstKept = state.items.findIndex((i) => i.at >= since);
      if (firstKept !== 0) state.items.splice(0, firstKept < 0 ? state.items.length : firstKept);
    }
  }

  /**
   * Title and directory, read from the stretch just before the window: a
   * conversation renamed this morning and quiet since must not show as
   * untitled. Bounded to one chunk — beyond it, the list's own title is used.
   */
  private async readHeader(state: FileState): Promise<void> {
    if (state.offset === 0) return;
    const start = Math.max(0, state.offset - CHUNK);
    const buf = await this.fs.read(state.path, start, state.offset - start);
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    if (start > 0) lines.shift();
    for (const line of lines) {
      for (const e of parseLine(line)) {
        if (e.kind === 'cwd') state.cwd = e.cwd;
        else if (e.kind === 'title' && (e.source === 'custom' || state.titleSource !== 'custom')) {
          state.title = e.title;
          state.titleSource = e.source;
        }
      }
    }
  }

  /** The files read, for the view builder. */
  get states(): readonly FileState[] {
    return [...this.files.values()];
  }
}
