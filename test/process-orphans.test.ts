import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findOrphans,
  looksLikeDevRuntime,
  orphansUnder,
  parseLsofFiles,
  reattachDetached,
  sessionOfOutput,
  subtreeOf,
  unattached,
  type Orphan,
  type ProcFiles,
} from '../src/process/orphans';
import { parsePs, tableOf } from '../src/process/scan';

// Replaced outright, never a passthrough: `findOrphans` is the only thing
// here that shells out (to `lsof`), and no test below wants the real
// binary — only a bug would make that happen.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

const ROWS = tableOf(parsePs(
  [
    '100   1  10 1000 /path/to/claude',
    '200 100  10 1000 node vite',
    '300   1  10 1000 node /Users/dev/projet/node_modules/.bin/vite',
    '400   1  10 1000 /opt/homebrew/bin/sqld --http-listen-addr 127.0.0.1:8080',
    '500   1  10 1000 /usr/libexec/secinitd',
    '600   1  10 1000 /System/Library/CoreServices/Dock.app/Contents/MacOS/Dock',
    '700 600  10 1000 python3 manage.py runserver',
  ].join('\n'),
));

/** The reading `lsof` would give: a directory per pid, and no redirected output. */
const at = (entries: readonly (readonly [number, string])[]): Map<number, ProcFiles> =>
  new Map(entries.map(([pid, cwd]) => [pid, { cwd, outputs: [] }]));

describe('unattached', () => {
  it('keeps what the process 1 adopted, and nothing a session carries', () => {
    // A session's own subtree already has a home in the sessions view. What
    // this view is for is what nothing carries any more.
    expect(unattached(ROWS).map((p) => p.pid)).toEqual([100, 300, 400, 500, 600]);
  });

  it('leaves out a process whose parent is alive, session or not', () => {
    const found = unattached(ROWS).map((p) => p.pid);
    expect(found).not.toContain(200);
    // 700 runs under the Dock: its parent is there, it is not adrift. A
    // process started in an open terminal is in the same position, and is
    // deliberately not listed — it is not lost, its terminal is right there.
    expect(found).not.toContain(700);
  });
});

describe('looksLikeDevRuntime', () => {
  it('recognises the runtimes a project is served with', () => {
    expect(looksLikeDevRuntime('node vite')).toBe(true);
    expect(looksLikeDevRuntime('/opt/homebrew/bin/sqld --http-listen-addr :8080')).toBe(true);
    expect(looksLikeDevRuntime('python3 manage.py runserver')).toBe(true);
    expect(looksLikeDevRuntime('/usr/bin/ruby bin/rails s')).toBe(true);
  });

  it('does not take a system daemon for one', () => {
    // The cheap filter exists precisely so the expensive one — reading a
    // working directory per process — is never run over three hundred daemons.
    expect(looksLikeDevRuntime('/usr/libexec/secinitd')).toBe(false);
    expect(looksLikeDevRuntime('/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock')).toBe(false);
  });

  it('matches the binary, not a path that happens to contain its name', () => {
    expect(looksLikeDevRuntime('/Users/dev/node-fan-club/bin/daemon')).toBe(false);
    expect(looksLikeDevRuntime('node /Users/dev/node-fan-club/bin/daemon')).toBe(true);
  });

  it('recognises the capitalised binary a macOS framework install ships', () => {
    // Observed, not imagined: a Homebrew Python runs as `.../MacOS/Python`,
    // with a capital P, and a case-sensitive filter dropped every orphaned
    // Python server on the machine.
    const real =
      '/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python -m http.server 8932';
    expect(looksLikeDevRuntime(real)).toBe(true);
  });

  it('recognises a versioned binary name', () => {
    expect(looksLikeDevRuntime('/usr/bin/python3.14 manage.py')).toBe(true);
    expect(looksLikeDevRuntime('/usr/local/bin/node22 server.js')).toBe(true);
  });
});

describe('orphansUnder — the subtree decides, not the adopted process alone', () => {
  // The shape a session killed outright leaves behind, and the one that
  // matters most: Claude Code takes its children with it on a clean exit, so a
  // window reload leaves nothing. A crash, a `kill -9` or a machine put to
  // sleep leaves the tool shell adopted by the process 1, with the server it
  // started still under IT. The adopted process is then a `zsh` — no
  // development runtime — and the server is not adopted at all.
  const SHELL_GHOST = tableOf(parsePs(
    [
      '800   1  10 1000 /bin/zsh -c python3 -m http.server 8934 --bind 127.0.0.1; true',
      '801 800  10 210000 /opt/homebrew/Cellar/python@3.14/bin/Python -m http.server 8934',
      '900   1  10 1000 /bin/zsh -c tail -f /var/log/system.log',
      '901 900  10 1000 tail -f /var/log/system.log',
    ].join('\n'),
  ));
  const cwds = at([
    [800, '/Users/jack/DEV/koh-vibe'],
    [900, '/Users/jack/DEV/koh-vibe'],
  ]);

  it('keeps an adopted shell whose child is a development runtime', () => {
    expect(orphansUnder(SHELL_GHOST, cwds, ['/Users/jack/DEV']).map((o) => o.root.pid)).toEqual([800]);
  });

  it('drops an adopted shell that runs nothing of the sort', () => {
    // A `tail` left behind is not a forgotten dev server, and this view is not
    // a process manager for the whole machine.
    expect(orphansUnder(SHELL_GHOST, cwds, ['/Users/jack/DEV']).map((o) => o.root.pid)).not.toContain(900);
  });

  it('carries the subtree, so the server hidden under the shell can be seen', () => {
    const [ghost] = orphansUnder(SHELL_GHOST, cwds, ['/Users/jack/DEV']);
    expect(ghost?.tree.map((p) => p.pid)).toEqual([800, 801]);
  });

  it('never calls an orphan someone MCP server', () => {
    // `kindOf` reads depth 0 as "started by a conversation". Applied here it
    // would file the adopted shell as an MCP server, and the confirmation
    // would warn about breaking a conversation that no longer exists.
    const [ghost] = orphansUnder(SHELL_GHOST, cwds, ['/Users/jack/DEV']);
    expect(ghost?.tree.map((p) => p.kind)).toEqual(['work', 'work']);
  });
});

describe('orphansUnder', () => {
  const cwds = at([
    [300, '/Users/jack/DEV/projet/packages/web'],
    [400, '/Users/jack/DEV/pity-tidy'],
    [500, '/'],
  ]);

  it('keeps a process working inside a known root, at any depth', () => {
    const roots = ['/Users/jack/DEV/projet'];
    expect(orphansUnder(ROWS, cwds, roots).map((o) => o.root.pid)).toEqual([300]);
  });

  it('carries the directory, which is the only thing saying where it belongs', () => {
    const found = orphansUnder(ROWS, cwds, ['/Users/jack/DEV/pity-tidy']);
    expect(found[0]?.cwd).toBe('/Users/jack/DEV/pity-tidy');
  });

  it('takes the root itself, not only what is under it', () => {
    expect(orphansUnder(ROWS, cwds, ['/Users/jack/DEV/pity-tidy']).map((o) => o.root.pid)).toEqual([400]);
  });

  it('does not mistake a sibling directory for a child of the root', () => {
    // `/Users/jack/DEV/projet-old` must not match the root `/Users/jack/DEV/projet`:
    // a plain `startsWith` would say it does, and list a process from another
    // project as belonging to this one.
    const sibling = at([[300, '/Users/jack/DEV/projet-old/src']]);
    expect(orphansUnder(ROWS, sibling, ['/Users/jack/DEV/projet'])).toEqual([]);
  });

  it('never lists a process whose directory is unknown', () => {
    expect(orphansUnder(ROWS, new Map(), ['/Users/jack/DEV'])).toEqual([]);
  });

  it('has nothing to show without roots, rather than showing the machine', () => {
    // No root means no project is known — an editor opened on no folder, say.
    // Falling back to "everything" would fill the view with system daemons.
    expect(orphansUnder(ROWS, cwds, [])).toEqual([]);
  });
});

describe('parseLsofFiles', () => {
  it('reads the working directory and the redirected outputs of each pid', () => {
    const stdout = [
      'p100',
      'fcwd',
      'n/Users/dev/projet',
      'f1',
      'n/tmp/claude-501/projet/11111111-1111-1111-1111-111111111111/scratchpad/out.log',
      'f2',
      'n/tmp/claude-501/projet/11111111-1111-1111-1111-111111111111/scratchpad/out.log',
    ].join('\n');
    const found = parseLsofFiles(stdout);
    expect(found.get(100)).toEqual({
      cwd: '/Users/dev/projet',
      outputs: [
        '/tmp/claude-501/projet/11111111-1111-1111-1111-111111111111/scratchpad/out.log',
        '/tmp/claude-501/projet/11111111-1111-1111-1111-111111111111/scratchpad/out.log',
      ],
    });
  });

  it('keeps one entry per pid, never mixing up two processes', () => {
    const stdout = ['p100', 'fcwd', 'n/Users/dev/un', 'p200', 'fcwd', 'n/Users/dev/deux'].join('\n');
    const found = parseLsofFiles(stdout);
    expect(found.get(100)).toEqual({ cwd: '/Users/dev/un', outputs: [] });
    expect(found.get(200)).toEqual({ cwd: '/Users/dev/deux', outputs: [] });
  });

  it('ignores a path with no pid in front of it', () => {
    // Nothing valid has been read yet: a stray `n` line before the first `p`
    // must not be filed under a pid that was never seen.
    const found = parseLsofFiles(['n/Users/dev/orphelin', 'p100', 'fcwd', 'n/Users/dev/projet'].join('\n'));
    expect([...found.keys()]).toEqual([100]);
  });

  it('ignores an empty path, rather than recording an entry with nothing in it', () => {
    const found = parseLsofFiles(['p100', 'fcwd', 'n'].join('\n'));
    expect(found.has(100)).toBe(false);
  });

  it('drops a pid line that is not a usable integer, without crashing the read that follows', () => {
    const found = parseLsofFiles(['pas-un-pid', 'fcwd', 'n/Users/dev/orphelin', 'p100', 'fcwd', 'n/Users/dev/projet'].join('\n'));
    expect([...found.keys()]).toEqual([100]);
  });
});

describe('sessionOfOutput', () => {
  const SESSION_ID = '11111111-1111-1111-1111-111111111111';

  it('reads the session id out of a scratchpad path', () => {
    expect(sessionOfOutput(`/tmp/claude-501/projet/${SESSION_ID}/scratchpad/out.log`)).toBe(SESSION_ID);
  });

  it('reads it out of a tasks path too', () => {
    expect(sessionOfOutput(`/tmp/claude-501/projet/${SESSION_ID}/tasks/out.log`)).toBe(SESSION_ID);
  });

  it('accepts the /private/tmp form macOS actually resolves it to', () => {
    expect(sessionOfOutput(`/private/tmp/claude-501/projet/${SESSION_ID}/scratchpad/out.log`)).toBe(SESSION_ID);
  });

  it('finds nothing in a path outside the temporary scratchpad shape', () => {
    expect(sessionOfOutput('/Users/dev/projet/out.log')).toBeUndefined();
    expect(sessionOfOutput(`/tmp/claude-501/projet/${SESSION_ID}/out.log`)).toBeUndefined();
  });

  it('never attributes a process from a uuid-shaped string that is not a valid session id', () => {
    // One character short of 36: the pattern itself requires the exact length.
    const short = SESSION_ID.slice(0, 35);
    expect(sessionOfOutput(`/tmp/claude-501/projet/${short}/scratchpad/out.log`)).toBeUndefined();
  });
});

describe('reattachDetached', () => {
  // The shape `orphansUnder` actually produces for a detached server: an
  // adopted shell with no development runtime of its own, and the server
  // under it — see the SHELL_GHOST fixture above for why the root alone is
  // not enough.
  const DETACHED = tableOf(parsePs(
    ['900   1  10 1000 /bin/zsh -c node server.js --port 4000', '901 900  10 1000 node server.js --port 4000'].join(
      '\n',
    ),
  ));
  const SESSION_ID = '11111111-1111-1111-1111-111111111111';

  function detachedOrphan(sessionId?: string): Orphan {
    const outputs = sessionId === undefined ? [] : [`/tmp/claude-501/projet/${sessionId}/scratchpad/out.log`];
    const files: ReadonlyMap<number, ProcFiles> = new Map([[900, { cwd: '/Users/dev/projet', outputs }]]);
    const [orphan] = orphansUnder(DETACHED, files, ['/Users/dev/projet']);
    if (orphan === undefined) throw new Error('the fixture was expected to produce exactly one orphan');
    return orphan;
  }

  it('puts a detached process back under the conversation that started it, when it is still alive', () => {
    const orphan = detachedOrphan(SESSION_ID);
    const result = reattachDetached(new Map(), [orphan], (id) => id === SESSION_ID);
    expect(result.processes.get(SESSION_ID)?.map((p) => p.pid)).toEqual([900, 901]);
    expect(result.adrift).toEqual([]);
  });

  it('appends to whatever the session was already running, rather than replacing it', () => {
    const existingTable = tableOf(parsePs(['200   1  10 1000 /path/to/claude', '201 200  10 1000 node vite'].join('\n')));
    const existing = new Map([[SESSION_ID, subtreeOf(existingTable, 200)]]);
    const orphan = detachedOrphan(SESSION_ID);
    const result = reattachDetached(existing, [orphan], () => true);
    expect(result.processes.get(SESSION_ID)?.map((p) => p.pid)).toEqual([200, 201, 900, 901]);
  });

  it('leaves an orphan adrift when the session it names is no longer alive', () => {
    const orphan = detachedOrphan(SESSION_ID);
    const result = reattachDetached(new Map(), [orphan], () => false);
    expect(result.processes.size).toBe(0);
    expect(result.adrift).toEqual([orphan]);
  });

  it('leaves an orphan adrift when it names no session at all', () => {
    const orphan = detachedOrphan(undefined);
    const result = reattachDetached(new Map(), [orphan], () => true);
    expect(result.adrift).toEqual([orphan]);
  });

  it('returns the very same map when nothing was claimed, so an unchanged render is recognised as one', () => {
    const processes = new Map<string, ReturnType<typeof subtreeOf>>();
    const orphan = detachedOrphan(undefined);
    const result = reattachDetached(processes, [orphan], () => true);
    expect(result.processes).toBe(processes);
  });
});

describe('findOrphans', () => {
  afterEach(() => {
    execFileMock.mockReset();
  });

  it('has nothing to show without roots, and never shells out to lsof for it', async () => {
    expect(await findOrphans(ROWS, [])).toEqual([]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('never calls lsof when nothing adopted looks like a development runtime', async () => {
    const NO_DEV_RUNTIME = tableOf(parsePs('500   1  10 1000 /usr/libexec/secinitd'));
    expect(await findOrphans(NO_DEV_RUNTIME, ['/Users/jack/DEV'])).toEqual([]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('asks lsof only for the candidates the cheap filter kept, then reads their directory', async () => {
    const CANDIDATES = tableOf(parsePs(
      ['700   1  10 1000 node server.js', '800   1  10 1000 /usr/libexec/secinitd'].join('\n'),
    ));
    execFileMock.mockImplementation(
      (command: string, args: readonly string[], _options: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        expect(command).toBe('lsof');
        expect(args).toEqual(['-a', '-d', 'cwd,1,2', '-p', '700', '-Fpn']);
        callback(null, 'p700\nfcwd\nn/Users/dev/projet\n', '');
        return {} as ChildProcess;
      },
    );
    const found = await findOrphans(CANDIDATES, ['/Users/dev/projet']);
    expect(found.map((o) => o.root.pid)).toEqual([700]);
  });

  it('passes the given timeout down to lsof, 3000 ms when none is given', async () => {
    const CANDIDATES = tableOf(parsePs('700   1  10 1000 node server.js'));
    execFileMock.mockImplementation(
      (_command: string, _args: readonly string[], options: { timeout: number }, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        expect(options.timeout).toBe(500);
        callback(null, '', '');
        return {} as ChildProcess;
      },
    );
    await findOrphans(CANDIDATES, ['/Users/dev/projet'], 500);

    execFileMock.mockImplementation(
      (_command: string, _args: readonly string[], options: { timeout: number }, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        expect(options.timeout).toBe(3_000);
        callback(null, '', '');
        return {} as ChildProcess;
      },
    );
    await findOrphans(CANDIDATES, ['/Users/dev/projet']);
  });
});
