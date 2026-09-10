import { describe, expect, it } from 'vitest';
import { looksLikeDevRuntime, orphansUnder, parseLsofCwds, unattached } from '../src/process/orphans';
import { parsePs } from '../src/process/scan';

const ROWS = parsePs(
  [
    '100   1  10 1000 /path/to/claude',
    '200 100  10 1000 node vite',
    '300   1  10 1000 node /Users/dev/projet/node_modules/.bin/vite',
    '400   1  10 1000 /opt/homebrew/bin/sqld --http-listen-addr 127.0.0.1:8080',
    '500   1  10 1000 /usr/libexec/secinitd',
    '600   1  10 1000 /System/Library/CoreServices/Dock.app/Contents/MacOS/Dock',
    '700 600  10 1000 python3 manage.py runserver',
  ].join('\n'),
);

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

describe('parseLsofCwds', () => {
  it('reads the pid and the directory of each block', () => {
    const out = ['p42621', 'fcwd', 'n/Users/jack/DEV/projet', 'p42633', 'fcwd', 'n/Users/jack/DEV/autre'].join('\n');
    expect(parseLsofCwds(out)).toEqual(
      new Map([
        [42_621, '/Users/jack/DEV/projet'],
        [42_633, '/Users/jack/DEV/autre'],
      ]),
    );
  });

  it('ignores a block whose directory never came', () => {
    // A process that exits between the `ps` and the `lsof` leaves its pid line
    // with nothing after it. It has no directory, so it cannot be placed under
    // a root, so it is simply not listed.
    expect(parseLsofCwds('p1\np42621\nfcwd\nn/Users/jack/DEV/projet')).toEqual(new Map([[42_621, '/Users/jack/DEV/projet']]));
  });

  it('survives an empty or unreadable output', () => {
    expect(parseLsofCwds('')).toEqual(new Map());
    expect(parseLsofCwds('lsof: not found')).toEqual(new Map());
  });
});

describe('orphansUnder — the subtree decides, not the adopted process alone', () => {
  // The shape a session killed outright leaves behind, and the one that
  // matters most: Claude Code takes its children with it on a clean exit, so a
  // window reload leaves nothing. A crash, a `kill -9` or a machine put to
  // sleep leaves the tool shell adopted by the process 1, with the server it
  // started still under IT. The adopted process is then a `zsh` — no
  // development runtime — and the server is not adopted at all.
  const SHELL_GHOST = parsePs(
    [
      '800   1  10 1000 /bin/zsh -c python3 -m http.server 8934 --bind 127.0.0.1; true',
      '801 800  10 210000 /opt/homebrew/Cellar/python@3.14/bin/Python -m http.server 8934',
      '900   1  10 1000 /bin/zsh -c tail -f /var/log/system.log',
      '901 900  10 1000 tail -f /var/log/system.log',
    ].join('\n'),
  );
  const cwds = new Map([
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
  const cwds = new Map([
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
    const sibling = new Map([[300, '/Users/jack/DEV/projet-old/src']]);
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
