import { execFile } from 'node:child_process';

/**
 * One line of `ps`, as the system reports it.
 *
 * Nothing here is specific to Claude Code: this is the raw material the rest
 * of the module carves a session's subtree out of.
 */
export interface ProcRow {
  pid: number;
  ppid: number;
  /** Seconds since the process started. */
  elapsed: number;
  /** Resident memory, in kilobytes — the column `ps` calls `rss`. */
  rss: number;
  command: string;
}

/** A row of the subtree of one session, with how deep under it it sits. */
export interface ProcNode extends ProcRow {
  /** 0 for a process the session started itself, 1 for its children, and so on. */
  depth: number;
}

/**
 * The columns, in this order, with no headers — `=` after each name is what
 * suppresses them. `command` comes last on purpose: it is the only one that
 * can contain spaces, so everything before it splits unambiguously and
 * everything after the fourth field is the command, whatever it holds.
 */
const PS_ARGS = ['-axo', 'pid=,ppid=,etime=,rss=,command='];

/**
 * `ps` reports an age as `ss`, `mm:ss`, `hh:mm:ss` or `dd-hh:mm:ss`. Anything
 * else is zero rather than `NaN`: this number is formatted straight into a
 * label, and a `NaN` there would show up on screen.
 */
export function parseElapsed(raw: string): number {
  const [days, rest] = raw.includes('-') ? raw.split('-', 2) : ['0', raw];
  const parts = [days ?? '0', ...(rest ?? '').split(':')].map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  // Seconds, minutes, hours, days — read from the end, so a short shape simply
  // stops early instead of needing a case of its own.
  const units = [1, 60, 3600, 86_400];
  let total = 0;
  const tail = parts.slice(1).reverse();
  for (let i = 0; i < tail.length && i < 3; i += 1) total += (tail[i] ?? 0) * (units[i] ?? 0);
  return total + (parts[0] ?? 0) * 86_400;
}

/**
 * The escapes `ps` writes in place of the control characters a command line
 * can hold, and their meaning. Tab, newline and carriage return, and nothing
 * else: those are the ones that occur in a real command — a heredoc, a
 * multi-line script passed to `-c` — and the ones whose absence is felt.
 *
 * **This decoding is ambiguous, and knowingly so.** `ps` does not escape a
 * backslash, so a command holding the four literal characters `\012` reaches
 * us exactly as a command holding a newline does; the two cannot be told
 * apart. Decoding therefore rewrites the rare command that meant the literal
 * text, and repairs the common one that meant the newline. Multi-line commands
 * are what the Bash tool runs all day; `printf 'a\012b'` is not.
 */
const PS_ESCAPES: Record<string, string> = { '011': '\t', '012': '\n', '015': '\r' };

/**
 * Turns the output of `ps` into rows, dropping anything that does not parse.
 *
 * Defensive on purpose, like the session registry: this feeds a view that
 * refreshes every couple of seconds, and one odd line must never cost the
 * whole list — let alone raise inside the render loop.
 */
export function parsePs(stdout: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/.exec(line);
    if (m === null) continue;
    rows.push({
      pid: Number.parseInt(m[1] ?? '', 10),
      ppid: Number.parseInt(m[2] ?? '', 10),
      elapsed: parseElapsed(m[3] ?? ''),
      rss: Number.parseInt(m[4] ?? '', 10),
      // Decoded HERE, after the line has been split into columns — never on the
      // whole output before splitting. A `\012` turned into a real newline
      // first would cut this command in two: its tail would be lost, or read as
      // another process entirely.
      command: decodeEscapes((m[5] ?? '').trim()),
    });
  }
  return rows;
}

function decodeEscapes(command: string): string {
  return command.replace(/\\(011|012|015)/g, (whole, code: string) => PS_ESCAPES[code] ?? whole);
}

/**
 * The table indexed for the walks below: every row by pid, and the children
 * of every parent, oldest first.
 *
 * Built once per snapshot and read by every walk. It exists because the walks
 * are many — one per live session, then one per process the system has
 * adopted, several hundred on a running machine — and each of them used to
 * rebuild this same index from the rows before taking a single step: some ten
 * milliseconds a tick, spent twice, on a loop that runs every two seconds.
 */
export interface ProcTable {
  readonly rows: readonly ProcRow[];
  readonly byPid: ReadonlyMap<number, ProcRow>;
  /** By parent pid, ordered by pid — which is to say oldest first, since pids grow. */
  readonly children: ReadonlyMap<number, readonly ProcRow[]>;
}

export function tableOf(rows: readonly ProcRow[]): ProcTable {
  const byPid = new Map<number, ProcRow>();
  const children = new Map<number, ProcRow[]>();
  for (const row of rows) {
    byPid.set(row.pid, row);
    // A process that is its own parent is the degenerate cycle, and the cheap
    // one to cut here rather than in every walk.
    if (row.pid === row.ppid) continue;
    const kids = children.get(row.ppid) ?? [];
    kids.push(row);
    children.set(row.ppid, kids);
  }
  for (const kids of children.values()) kids.sort((a, b) => a.pid - b.pid);
  return { rows, byPid, children };
}

/**
 * Everything running under `rootPid`, depth first, children of a same parent
 * oldest first.
 *
 * The root itself is never in the result: the caller already knows about the
 * session, what it is asking for is what the session started.
 *
 * A pid is only ever visited once. Process tables are not guaranteed to be a
 * tree — a pid reused between the moment `ps` read one row and the next can
 * make a cycle out of them — and this walk runs on a timer, so a cycle would
 * not be a wrong list but a frozen window.
 */
export function descendantsOf(table: ProcTable, rootPid: number): ProcNode[] {
  const out: ProcNode[] = [];
  const seen = new Set<number>([rootPid]);
  const walk = (pid: number, depth: number): void => {
    for (const row of table.children.get(pid) ?? []) {
      if (seen.has(row.pid)) continue;
      seen.add(row.pid);
      out.push({ ...row, depth });
      walk(row.pid, depth + 1);
    }
  };
  walk(rootPid, 0);
  return out;
}

/**
 * The whole process table, or nothing.
 *
 * Never rejects: this is called from the render loop, and a `ps` that is
 * missing, slow or killed must cost the process list, never the dashboard.
 * The timeout is the reason the promise exists at all — a hung `ps` would
 * otherwise hold a tick open until the editor closes.
 */
export function snapshot(timeoutMs = 2_000): Promise<ProcTable> {
  return new Promise((resolve) => {
    execFile('ps', PS_ARGS, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(tableOf(err !== null && stdout.length === 0 ? [] : parsePs(stdout)));
    });
  });
}
