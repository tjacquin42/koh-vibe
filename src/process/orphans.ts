import { execFile } from 'node:child_process';
import { classifyDetached, type SessionProcess } from './classify';
import { descendantsOf, type ProcRow } from './scan';

/**
 * A process no conversation carries any more: a development server whose
 * session is gone, still holding its port.
 *
 * These are the ones the sessions view cannot show, by construction — a
 * process that loses its parent is adopted by the process 1, which takes it out
 * of every session's subtree. Finding them again is the whole point of this
 * module.
 */
export interface Orphan {
  /** The adopted process itself — a shell as often as a server. */
  root: SessionProcess;
  /** The root and everything under it, so what it hides can be unfolded. */
  tree: SessionProcess[];
  /** Its working directory. Always known: it is what placed it under a root. */
  cwd: string;
}

/**
 * The binaries a project is actually served with.
 *
 * This list is the cheap filter, and it exists so the expensive one — one
 * working directory read per process — never runs over the three hundred
 * daemons of a running system. It is matched against the binary's own name,
 * never the whole line: a path that merely contains `node` is not a `node`.
 */
const DEV_RUNTIMES = new Set([
  'node',
  'deno',
  'bun',
  'python',
  'python2',
  'python3',
  'ruby',
  'php',
  'java',
  'go',
  'cargo',
  'dotnet',
  'npm',
  'pnpm',
  'yarn',
  'vite',
  'esbuild',
  'next',
  'nuxt',
  'webpack',
  'rollup',
  'gunicorn',
  'uvicorn',
  'puma',
  'rails',
  'sqld',
  'turso',
  'postgres',
  'redis-server',
  'mongod',
  'supabase',
  'wrangler',
  'vercel',
  'ng',
  'flutter',
  'gradle',
]);

export function looksLikeDevRuntime(command: string): boolean {
  const head = command.trim().split(' ')[0] ?? '';
  // Lower-cased, because a framework install capitalises its binary: a
  // Homebrew Python runs as `.../MacOS/Python`, and a case-sensitive test
  // dropped every orphaned Python server on the machine — found by running
  // one, not by reading the list.
  const name = head.slice(head.lastIndexOf('/') + 1).toLowerCase();
  // `python3.14` and `node22` count as their runtime: version suffixes are
  // common on installed binaries, and dropping them costs nothing here.
  return DEV_RUNTIMES.has(name) || DEV_RUNTIMES.has(name.replace(/[\d.]+$/, ''));
}

/**
 * The processes the process 1 has adopted.
 *
 * A live parent means the process is not adrift: something still holds it, and
 * whoever started it can see it. That includes a command run in an open
 * terminal, which is deliberately absent from this view — it is not lost, its
 * terminal is right there. What is listed is what nothing carries any more.
 */
export function unattached(rows: readonly ProcRow[]): ProcRow[] {
  return rows.filter((row) => row.ppid === 1);
}

/**
 * Reads the working directory of each pid, in ONE call.
 *
 * `lsof -Fpn` emits a block per process: `p<pid>`, then a line per file
 * descriptor. Restricted to `-d cwd`, that is one path per process. Parsed
 * defensively like everything else on this path — a pid whose path never came
 * is dropped rather than guessed at, which is also what happens to a process
 * that exits between the `ps` and the `lsof`.
 */
export function parseLsofCwds(stdout: string): Map<number, string> {
  const out = new Map<number, string>();
  let pid: number | undefined;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) {
      const parsed = Number.parseInt(line.slice(1), 10);
      pid = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    } else if (line.startsWith('n') && pid !== undefined && line.length > 1) {
      out.set(pid, line.slice(1));
      pid = undefined;
    }
  }
  return out;
}

/**
 * Whether a directory is a known root, or sits inside one.
 *
 * The separator matters: without it, the root `/a/projet` would claim
 * `/a/projet-old`, and a process from one project would be listed under
 * another.
 */
function isUnder(cwd: string, root: string): boolean {
  return cwd === root || cwd.startsWith(root.endsWith('/') ? root : `${root}/`);
}

/**
 * The unattached processes that work inside one of the known roots.
 *
 * No roots means nothing is listed. Falling back to "everything" would fill the
 * view with system daemons, which is the opposite of what it is for: the roots
 * are what make a listed process recognisably the user's own.
 */
/**
 * The subtree an adopted process carries: itself, then everything under it.
 *
 * Whole, because what was adopted is rarely what matters. A session killed
 * outright leaves its tool shell adopted, with the server it started still
 * under IT — so the shell is the orphan, a `zsh` and no development runtime,
 * while the server that holds the port is not adopted at all. Judging the
 * adopted process on its own missed exactly the case this view exists for.
 */
export function subtreeOf(rows: readonly ProcRow[], pid: number): SessionProcess[] {
  const self = rows.find((r) => r.pid === pid);
  if (self === undefined) return [];
  return classifyDetached([{ ...self, depth: 0 }, ...descendantsOf(rows, pid).map((d) => ({ ...d, depth: d.depth + 1 }))]);
}

export function orphansUnder(
  rows: readonly ProcRow[],
  cwds: ReadonlyMap<number, string>,
  roots: readonly string[],
): Orphan[] {
  if (roots.length === 0) return [];
  const out: Orphan[] = [];
  for (const row of unattached(rows)) {
    const cwd = cwds.get(row.pid);
    if (cwd === undefined || !roots.some((root) => isUnder(cwd, root))) continue;
    const tree = subtreeOf(rows, row.pid);
    // The whole subtree is asked, not the root: see `subtreeOf`. A shell that
    // runs nothing of interest — a `tail` left behind — is not what this view
    // is for, and listing it would turn it into a process manager.
    if (!tree.some((p) => looksLikeDevRuntime(p.command))) continue;
    const root = tree.find((p) => p.depth === 0);
    if (root === undefined) continue;
    out.push({ root, tree, cwd });
  }
  return out;
}

/**
 * The unattached development processes working under one of `roots`, ready to
 * display.
 *
 * Two readings, in this order and never the other way round: `ps` says who is
 * adrift and what it runs, the name filter cuts that down to a handful, and
 * only then is `lsof` asked for their directories. Reversed, this would read a
 * directory for every process on the machine — several hundred — on every tick
 * the panel is open.
 *
 * Never rejects, like `snapshot`: an `lsof` that is missing or slow costs this
 * section, never the dashboard.
 */
export async function findOrphans(
  rows: readonly ProcRow[],
  roots: readonly string[],
  timeoutMs = 3_000,
): Promise<Orphan[]> {
  if (roots.length === 0) return [];
  // The cheap filter, applied to the SUBTREE rather than to the adopted
  // process: an adopted `zsh` holding a dev server is the shape that matters,
  // and testing the root alone let it through unseen. The walk itself is in
  // memory and costs nothing next to the reading that follows.
  const candidates = unattached(rows).filter((row) =>
    subtreeOf(rows, row.pid).some((p) => looksLikeDevRuntime(p.command)),
  );
  if (candidates.length === 0) return [];
  const cwds = await readCwds(
    candidates.map((c) => c.pid),
    timeoutMs,
  );
  return orphansUnder(rows, cwds, roots);
}

function readCwds(pids: readonly number[], timeoutMs: number): Promise<Map<number, string>> {
  return new Promise((resolve) => {
    // `lsof` exits non-zero when it could not stat every process it was asked
    // about, which is the normal case here — so the output is read whatever the
    // status says, and only an empty one gives up.
    execFile(
      'lsof',
      ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn'],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (_err, stdout) => resolve(parseLsofCwds(stdout)),
    );
  });
}
