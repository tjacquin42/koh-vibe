import { execFile } from 'node:child_process';
import { classifyDetached, type SessionProcess } from './classify';
import { descendantsOf, type ProcRow, type ProcTable } from './scan';
import { isValidSessionId } from '../events/parse';

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
  /**
   * The conversation that started it, when it can still be told.
   *
   * A session that starts a server detached loses it from its own subtree —
   * the system reparents it at once — but the output file it redirected still
   * names the conversation. Set here, such a process is put back under its
   * session rather than listed as belonging to nobody.
   */
  sessionId?: string;
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
export function unattached(table: ProcTable): readonly ProcRow[] {
  return table.children.get(1) ?? [];
}

/** What one process had open, of the few descriptors we asked about. */
export interface ProcFiles {
  cwd?: string;
  /** Where its standard output and error go, when they go to files. */
  outputs: string[];
}

/**
 * The same reading, keeping the output files as well as the directory.
 *
 * `lsof -Fpn` emits `p<pid>`, then a pair of `f<descriptor>` / `n<path>` lines
 * per descriptor. Which descriptor a path belongs to therefore has to be
 * tracked as the lines go by: `cwd` places the process in a project, and the
 * standard descriptors say which conversation redirected it — see
 * `sessionOfOutput`.
 */
export function parseLsofFiles(stdout: string): Map<number, ProcFiles> {
  const out = new Map<number, ProcFiles>();
  let pid: number | undefined;
  let fd: string | undefined;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) {
      const parsed = Number.parseInt(line.slice(1), 10);
      pid = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
      fd = undefined;
    } else if (line.startsWith('f')) {
      fd = line.slice(1);
    } else if (line.startsWith('n') && pid !== undefined && fd !== undefined && line.length > 1) {
      const path = line.slice(1);
      const entry = out.get(pid) ?? { outputs: [] };
      if (fd === 'cwd') entry.cwd = path;
      else entry.outputs.push(path);
      out.set(pid, entry);
      fd = undefined;
    }
  }
  return out;
}

/**
 * The conversation a redirected output file belongs to.
 *
 * A session that starts a server detached — output redirected to a file — puts
 * that file in its own scratchpad, and the path carries the conversation's id.
 * Once the process has been reparented away from its session, this is the only
 * link back to it that survives.
 *
 * The shape is pinned deliberately tightly: the temporary root, then one
 * segment for the project, then the id, then `scratchpad` or `tasks`. A uuid
 * found anywhere in any path would attribute other people's processes to a
 * conversation, which is worse than attributing none.
 */
export function sessionOfOutput(path: string): string | undefined {
  const m = /^\/(?:private\/)?tmp\/claude-\d+\/[^/]+\/([0-9a-f-]{36})\/(?:scratchpad|tasks)\//.exec(path);
  const id = m?.[1];
  // The uuid shape is asserted by the pattern; `isValidSessionId` still has the
  // last word, because this id is about to be used as a map key against ids
  // that came from the registry, and the two must agree on what an id is.
  return id !== undefined && isValidSessionId(id) ? id : undefined;
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
 * The subtree an adopted process carries: itself, then everything under it.
 *
 * Whole, because what was adopted is rarely what matters. A session killed
 * outright leaves its tool shell adopted, with the server it started still
 * under IT — so the shell is the orphan, a `zsh` and no development runtime,
 * while the server that holds the port is not adopted at all. Judging the
 * adopted process on its own missed exactly the case this view exists for.
 */
export function subtreeOf(table: ProcTable, pid: number): SessionProcess[] {
  const self = table.byPid.get(pid);
  if (self === undefined) return [];
  return classifyDetached([{ ...self, depth: 0 }, ...descendantsOf(table, pid).map((d) => ({ ...d, depth: d.depth + 1 }))]);
}

/**
 * The unattached processes that work inside one of the known roots.
 *
 * No roots means nothing is listed. Falling back to "everything" would fill the
 * view with system daemons, which is the opposite of what it is for: the roots
 * are what make a listed process recognisably the user's own.
 */
export function orphansUnder(
  table: ProcTable,
  files: ReadonlyMap<number, ProcFiles>,
  roots: readonly string[],
): Orphan[] {
  if (roots.length === 0) return [];
  const out: Orphan[] = [];
  for (const row of unattached(table)) {
    const entry = files.get(row.pid);
    const cwd = entry?.cwd;
    if (entry === undefined || cwd === undefined || !roots.some((root) => isUnder(cwd, root))) continue;
    const tree = subtreeOf(table, row.pid);
    // The whole subtree is asked, not the root: see `subtreeOf`. A shell that
    // runs nothing of interest — a `tail` left behind — is not what this view
    // is for, and listing it would turn it into a process manager.
    if (!tree.some((p) => looksLikeDevRuntime(p.command))) continue;
    const root = tree.find((p) => p.depth === 0);
    if (root === undefined) continue;
    const orphan: Orphan = { root, tree, cwd };
    // The first output that names a conversation wins; standard output and
    // standard error normally name the same one.
    const sessionId = entry.outputs.map(sessionOfOutput).find((id) => id !== undefined);
    if (sessionId !== undefined) orphan.sessionId = sessionId;
    out.push(orphan);
  }
  return out;
}

/**
 * Puts the detached processes back under the conversations that started them.
 *
 * A process a session detached is still that session's work — it only lost
 * the parent link, not the ownership — so it goes back under its conversation,
 * as a root of its own beside the commands still running in-tree, and leaves
 * the « No session » list, which is for what nothing accounts for.
 *
 * Only under a conversation that still runs: a server outliving its session
 * is exactly what that list is for. Whether it runs is asked, not read off the
 * map — a session with no server and no command in flight has no entry there,
 * and its detached server is its own all the same.
 *
 * Returns the very map it was given when nothing was claimed, for the reason
 * `withAgents` does: the views compare what they render to decide whether to
 * redraw, and an identical structure rebuilt every tick would defeat that.
 */
export function reattachDetached(
  processes: ReadonlyMap<string, SessionProcess[]>,
  adrift: readonly Orphan[],
  alive: (sessionId: string) => boolean,
): { processes: ReadonlyMap<string, SessionProcess[]>; adrift: Orphan[] } {
  const out = new Map(processes);
  const left: Orphan[] = [];
  let claimed = false;
  for (const orphan of adrift) {
    const sessionId = orphan.sessionId;
    if (sessionId === undefined || !alive(sessionId)) {
      left.push(orphan);
      continue;
    }
    out.set(sessionId, [...(out.get(sessionId) ?? []), ...orphan.tree]);
    claimed = true;
  }
  return { processes: claimed ? out : processes, adrift: left };
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
  table: ProcTable,
  roots: readonly string[],
  timeoutMs = 3_000,
): Promise<Orphan[]> {
  if (roots.length === 0) return [];
  // The cheap filter, applied to the SUBTREE rather than to the adopted
  // process: an adopted `zsh` holding a dev server is the shape that matters,
  // and testing the root alone let it through unseen. The walk itself is in
  // memory and costs nothing next to the reading that follows.
  const candidates = unattached(table).filter((row) =>
    subtreeOf(table, row.pid).some((p) => looksLikeDevRuntime(p.command)),
  );
  if (candidates.length === 0) return [];
  const files = await readFiles(
    candidates.map((c) => c.pid),
    timeoutMs,
  );
  return orphansUnder(table, files, roots);
}

function readFiles(pids: readonly number[], timeoutMs: number): Promise<Map<number, ProcFiles>> {
  return new Promise((resolve) => {
    // Three descriptors in one reading: the working directory places the
    // process in a project, and the standard output and error name the
    // conversation that redirected it, if one did.
    //
    // `lsof` exits non-zero when it could not stat every process it was asked
    // about, which is the normal case here — so the output is read whatever the
    // status says, and only an empty one gives up.
    execFile(
      'lsof',
      ['-a', '-d', 'cwd,1,2', '-p', pids.join(','), '-Fpn'],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (_err, stdout) => resolve(parseLsofFiles(stdout)),
    );
  });
}
