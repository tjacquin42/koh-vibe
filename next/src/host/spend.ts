/**
 * Which conversations spent the most (15/11), over the last 5 hours, 24 hours
 * and 7 days — read from the transcripts, where every answer of Claude is
 * written with its moment and its tokens. The usage limits say how much was
 * spent; this says by whom.
 *
 * « Spent » is an estimate in the units the limits are counted in: tokens
 * weighted by what they cost — an output token five input ones, a cache read a
 * tenth, a cache write a quarter more — and by the model, Opus five times
 * Haiku. Shown as a share of the window, never as a price.
 *
 * Read incrementally: each file from where the last pass stopped, only files
 * touched within the week, and what is older than the week dropped. A
 * conversation's subagents (`<id>/subagents/*.jsonl`) count towards it.
 */
import { open, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { SpendEntryView, SpendView, SpendWindow } from '../shared/protocol';

const HOUR = 3_600_000;
export const SPEND_WINDOWS: Record<SpendWindow, number> = { '5h': 5 * HOUR, '24h': 24 * HOUR, '7d': 7 * 24 * HOUR };
const WEEK = SPEND_WINDOWS['7d'];
/** How many conversations each window lists. */
export const SPEND_TOP = 5;

/** An ISO timestamp, as Claude Code writes it: compared as text, it orders as time does. */
const TIMESTAMP = /"timestamp":"([^"]+)"/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Usage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** A model's price, relative to Haiku's: what makes its tokens weigh more. */
export function modelWeight(model: string): number {
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 1;
  if (m.includes('sonnet')) return 3;
  // Opus, and the largest models after it.
  return 5;
}

/** What an answer cost, in Haiku input tokens. */
export function weightOf(model: string, u: Usage): number {
  const tokens = n(u.input_tokens) + 1.25 * n(u.cache_creation_input_tokens) + 0.1 * n(u.cache_read_input_tokens) + 5 * n(u.output_tokens);
  return tokens * modelWeight(model);
}

/** One transcript file followed: where the last pass stopped, and what it found within the week. */
export interface FileSpend {
  readonly sessionId: string;
  offset: number;
  /** Answers already counted: Claude Code writes one line per block of the same answer, each with its usage. */
  readonly seen: Set<string>;
  points: { at: number; weight: number }[];
  title?: string;
}

/** Takes in whole lines of a transcript. Pure: what the file reader feeds, and what the tests drive. */
export function takeLines(file: FileSpend, lines: readonly string[], since: number): void {
  // A week of transcripts weighs hundreds of megabytes: only the lines that
  // can matter are decoded — an answer recent enough, or a title.
  const sinceIso = new Date(since).toISOString();
  for (const line of lines) {
    if (line.length === 0) continue;
    const titled = line.includes('title"');
    if (!titled) {
      if (!line.includes('"type":"assistant"')) continue;
      const at = TIMESTAMP.exec(line)?.[1];
      if (at !== undefined && at < sinceIso) continue;
    }
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof e !== 'object' || e === null) continue;
    const entry = e as Record<string, unknown>;
    if (entry['type'] === 'custom-title' && typeof entry['customTitle'] === 'string') file.title = entry['customTitle'];
    else if (entry['type'] === 'ai-title' && typeof entry['aiTitle'] === 'string' && file.title === undefined) file.title = entry['aiTitle'];
    if (entry['type'] !== 'assistant') continue;
    const message = entry['message'];
    if (typeof message !== 'object' || message === null) continue;
    const m = message as Record<string, unknown>;
    const at = typeof entry['timestamp'] === 'string' ? Date.parse(entry['timestamp']) : NaN;
    if (!Number.isFinite(at) || at < since) continue;
    const id = typeof m['id'] === 'string' ? m['id'] : undefined;
    if (id !== undefined) {
      if (file.seen.has(id)) continue;
      file.seen.add(id);
    }
    const usage = m['usage'];
    if (typeof usage !== 'object' || usage === null) continue;
    const weight = weightOf(typeof m['model'] === 'string' ? m['model'] : '', usage as Usage);
    if (weight > 0) file.points.push({ at, weight });
  }
}

/** The conversations that spent the most in each window, by share of that window. */
export function rankSpend(files: Iterable<FileSpend>, now: number, top: number = SPEND_TOP): SpendView {
  const windows = {} as Record<SpendWindow, SpendEntryView[]>;
  const all = [...files];
  for (const w of Object.keys(SPEND_WINDOWS) as SpendWindow[]) {
    const since = now - SPEND_WINDOWS[w];
    const bySession = new Map<string, { weight: number; title?: string }>();
    let total = 0;
    for (const f of all) {
      let sum = 0;
      for (const p of f.points) if (p.at >= since) sum += p.weight;
      if (sum === 0) continue;
      total += sum;
      const was = bySession.get(f.sessionId) ?? { weight: 0 };
      was.weight += sum;
      if (f.title !== undefined) was.title = f.title;
      bySession.set(f.sessionId, was);
    }
    windows[w] = [...bySession]
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, top)
      .map(([sessionId, v]) => {
        const entry: SpendEntryView = { sessionId, share: v.weight / total };
        return v.title === undefined ? entry : { ...entry, title: v.title };
      });
  }
  return { at: now, windows };
}

/** The transcripts on disk, and their reading — kept between passes. */
export class Spend {
  private readonly files = new Map<string, FileSpend>();
  private running: Promise<SpendView> | undefined;
  private last: SpendView | undefined;

  constructor(private readonly projectsDir: string) {}

  /** The latest ranking, if a pass has finished. */
  current(): SpendView | undefined {
    return this.last;
  }

  /** One pass over what changed; a pass under way is joined, not doubled. */
  refresh(now: number): Promise<SpendView> {
    this.running ??= this.pass(now).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async pass(now: number): Promise<SpendView> {
    const since = now - WEEK;
    for (const [path, sessionId] of await this.transcripts(since)) {
      const file = this.files.get(path) ?? { sessionId, offset: 0, seen: new Set<string>(), points: [] };
      this.files.set(path, file);
      await this.readFrom(path, file, since);
    }
    for (const [path, f] of this.files) {
      f.points = f.points.filter((p) => p.at >= since);
      if (f.points.length === 0 && f.offset > 0 && !(await touchedSince(path, since))) this.files.delete(path);
    }
    this.last = rankSpend(this.files.values(), now);
    return this.last;
  }

  /** Every transcript touched within the week, with the conversation it counts towards. */
  private async transcripts(since: number): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const projects = await readdir(this.projectsDir).catch(() => [] as string[]);
    for (const project of projects) {
      const dir = join(this.projectsDir, project);
      const names = await readdir(dir).catch(() => [] as string[]);
      for (const name of names) {
        const id = name.endsWith('.jsonl') ? basename(name, '.jsonl') : name;
        if (!ID.test(id)) continue;
        if (name.endsWith('.jsonl')) {
          const path = join(dir, name);
          if (await touchedSince(path, since)) out.set(path, id);
          continue;
        }
        const agents = join(dir, name, 'subagents');
        for (const a of await readdir(agents).catch(() => [] as string[])) {
          const path = join(agents, a);
          if (a.endsWith('.jsonl') && (await touchedSince(path, since))) out.set(path, id);
        }
      }
    }
    return out;
  }

  /** Reads the whole lines added since the last pass; a line still being written waits for the next. */
  private async readFrom(path: string, file: FileSpend, since: number): Promise<void> {
    const handle = await open(path, 'r').catch(() => undefined);
    if (handle === undefined) return;
    try {
      const { size } = await handle.stat();
      if (size < file.offset) {
        // Replaced, not appended to: read again from the start.
        file.offset = 0;
        file.seen.clear();
        file.points = [];
      }
      if (size === file.offset) return;
      const buffer = Buffer.allocUnsafe(size - file.offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, file.offset);
      const chunk = buffer.subarray(0, bytesRead);
      const lastBreak = chunk.lastIndexOf(0x0a);
      if (lastBreak < 0) return;
      takeLines(file, chunk.subarray(0, lastBreak).toString('utf8').split('\n'), since);
      file.offset += lastBreak + 1;
    } finally {
      await handle.close();
    }
  }
}

async function touchedSince(path: string, since: number): Promise<boolean> {
  const s = await stat(path).catch(() => undefined);
  return s !== undefined && s.mtimeMs >= since;
}
