import { describe, expect, it } from 'vitest';
import { parseLsofFiles, sessionOfOutput } from '../src/process/orphans';

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
