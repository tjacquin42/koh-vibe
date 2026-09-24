import { describe, expect, it } from 'vitest';
import { parseLsofFiles, reattachDetached, sessionOfOutput, subtreeOf, type Orphan } from '../src/process/orphans';
import { classify } from '../src/process/classify';
import { descendantsOf, parsePs, tableOf } from '../src/process/scan';

const SESSION = '2738e133-be05-4851-91a1-1562ba356512';

describe('sessionOfOutput', () => {
  it('reads the conversation out of a scratchpad path', () => {
    // Observed on a real detached server: a session that redirects a server's
    // output writes it into its own scratchpad, and that path carries the id
    // of the conversation that started it — the only link left once the
    // process has been reparented away from its session.
    expect(sessionOfOutput(`/private/tmp/claude-501/-Users-jack-DEV/${SESSION}/scratchpad/pipeline-dev.log`)).toBe(SESSION);
  });

  it('reads it out of a task output path too', () => {
    expect(sessionOfOutput(`/private/tmp/claude-501/-Users-jack-DEV/${SESSION}/tasks/bqjz4lvg7.output`)).toBe(SESSION);
  });

  it('ignores a path that merely contains something uuid-shaped', () => {
    // Claiming a process for a conversation on the strength of a uuid found
    // anywhere would attribute other people's processes to it.
    expect(sessionOfOutput(`/Users/jack/projects/${SESSION}/build.log`)).toBeUndefined();
    expect(sessionOfOutput('/var/log/system.log')).toBeUndefined();
    expect(sessionOfOutput('')).toBeUndefined();
  });

  it('ignores a claude temp path whose segment is not a session id', () => {
    expect(sessionOfOutput('/private/tmp/claude-501/-Users-jack-DEV/not-a-uuid/scratchpad/x.log')).toBeUndefined();
  });

  it('is not fooled by a devicelike prefix', () => {
    expect(sessionOfOutput(`/private/tmp/claudia-501/-slug/${SESSION}/scratchpad/x.log`)).toBeUndefined();
  });
});

describe('parseLsofFiles', () => {
  const OUT = [
    'p3546',
    'fcwd',
    'n/Users/jack/DEV/project-pipeline/apps/web',
    'f1',
    `n/private/tmp/claude-501/-Users-jack-DEV/${SESSION}/scratchpad/pipeline-dev.log`,
    'f2',
    `n/private/tmp/claude-501/-Users-jack-DEV/${SESSION}/scratchpad/pipeline-dev.log`,
    'p77589',
    'fcwd',
    'n/Users/jack/DEV/koh-vibe',
  ].join('\n');

  it('separates the working directory from the output files', () => {
    const found = parseLsofFiles(OUT);
    expect(found.get(3546)?.cwd).toBe('/Users/jack/DEV/project-pipeline/apps/web');
    expect(found.get(3546)?.outputs).toHaveLength(2);
  });

  it('leaves the outputs empty for a process that redirects nothing', () => {
    expect(parseLsofFiles(OUT).get(77_589)).toEqual({ cwd: '/Users/jack/DEV/koh-vibe', outputs: [] });
  });

  it('survives an empty or unreadable output', () => {
    expect(parseLsofFiles('')).toEqual(new Map());
    expect(parseLsofFiles('lsof: not found')).toEqual(new Map());
  });

  it('drops a block that carries no path at all', () => {
    expect(parseLsofFiles('p1\np2\nfcwd\nn/tmp').get(1)).toBeUndefined();
  });
});

describe('reattachDetached', () => {
  // Two adopted trees: a dev server a session detached, and a shell nothing
  // claims. What a live session still holds in-tree sits under pid 100.
  const adopted = tableOf(
    parsePs(
      [
        '800   1  10 1000 /bin/zsh -c pnpm dev',
        '801 800  10 210000 node vite',
        '900   1  10 1000 /bin/zsh -c python3 -m http.server',
      ].join('\n'),
    ),
  );
  const orphan = (pid: number, sessionId?: string): Orphan => {
    const tree = subtreeOf(adopted, pid);
    const root = tree[0];
    if (root === undefined) throw new Error('fixture: unknown pid');
    return sessionId === undefined ? { root, tree, cwd: '/Users/jack/DEV/app' } : { root, tree, cwd: '/Users/jack/DEV/app', sessionId };
  };
  const inTree = classify(
    descendantsOf(tableOf(parsePs(['100 1 10 1000 /path/to/claude', '200 100 10 1000 /bin/zsh -c pnpm test'].join('\n'))), 100),
  );

  it('puts a detached tree back under the live session that started it', () => {
    const { processes, adrift } = reattachDetached(new Map([['s1', inTree]]), [orphan(800, 's1')], () => true);
    expect(processes.get('s1')?.map((p) => p.pid)).toEqual([200, 800, 801]);
    expect(adrift).toEqual([]);
  });

  it('does so even when that session runs nothing else', () => {
    // A session with no MCP server and no command in flight has no entry in
    // the map at all. Its detached server is still its own work — and listing
    // it as belonging to nobody, next to a conversation that is right there,
    // would be the view contradicting itself.
    const { processes, adrift } = reattachDetached(new Map(), [orphan(800, 's1')], (id) => id === 's1');
    expect(processes.get('s1')?.map((p) => p.pid)).toEqual([800, 801]);
    expect(adrift).toEqual([]);
  });

  it('leaves adrift what belongs to a session that is gone', () => {
    // A server outliving its conversation is exactly what the orphan list is for.
    const { processes, adrift } = reattachDetached(new Map([['s1', inTree]]), [orphan(800, 's2')], (id) => id === 's1');
    expect(processes.get('s2')).toBeUndefined();
    expect(adrift.map((o) => o.root.pid)).toEqual([800]);
  });

  it('leaves adrift what names no session at all', () => {
    const { adrift } = reattachDetached(new Map([['s1', inTree]]), [orphan(900)], () => true);
    expect(adrift.map((o) => o.root.pid)).toEqual([900]);
  });

  it('returns the very same map when nothing was claimed, so nothing redraws', () => {
    const before = new Map([['s1', inTree]]);
    expect(reattachDetached(before, [orphan(900)], () => true).processes).toBe(before);
  });
});
