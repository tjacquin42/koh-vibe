import { describe, expect, it } from 'vitest';
import { descendantsOf, parseElapsed, parsePs } from '../src/process/scan';

const PS = [
  '  501     1     02:13:07    4200 /sbin/launchd',
  '83287 93151        02:13  223744 /path/to/claude --output-format stream-json',
  '83297 83287        02:13   17968 /opt/homebrew/bin/uv tool uvx alpaca-mcp-server',
  '83325 83297        02:13   40100 /Users/jack/.cache/uv/bin/python -m alpaca_mcp',
  "85171 83287           42    3344 /bin/zsh -c source /Users/jack/.claude/shell-snapshots/snap.sh && eval 'pnpm dev'",
  '85179 85171           42  210000 node vite',
  '90000 93151        01:00    5000 /some/other/session',
].join('\n');

describe('parsePs', () => {
  it('reads the four numeric columns and keeps the rest as the command', () => {
    const rows = parsePs(PS);
    expect(rows).toHaveLength(7);
    expect(rows[1]).toEqual({
      pid: 83287,
      ppid: 93151,
      elapsed: 133,
      rss: 223744,
      command: '/path/to/claude --output-format stream-json',
    });
  });

  it('keeps the spaces inside a command line', () => {
    const rows = parsePs('12 1 5 100 node vite --port 3000');
    expect(rows[0]?.command).toBe('node vite --port 3000');
  });

  it('ignores a line missing a column rather than throwing', () => {
    expect(parsePs('garbage\n\n  12 34\n')).toEqual([]);
  });

  it('survives an empty listing', () => {
    expect(parsePs('')).toEqual([]);
  });
});

describe('parseElapsed', () => {
  it('reads the three shapes ps uses', () => {
    expect(parseElapsed('42')).toBe(42);
    expect(parseElapsed('01:20')).toBe(80);
    expect(parseElapsed('02:13:07')).toBe(7987);
    expect(parseElapsed('3-02:13:07')).toBe(267_187);
  });

  it('is zero for anything unreadable, never NaN', () => {
    expect(parseElapsed('')).toBe(0);
    expect(parseElapsed('later')).toBe(0);
  });
});

describe('descendantsOf', () => {
  it('walks the whole subtree, depth first, and carries the depth', () => {
    const found = descendantsOf(parsePs(PS), 83287);
    expect(found.map((p) => [p.pid, p.depth])).toEqual([
      [83297, 0],
      [83325, 1],
      [85171, 0],
      [85179, 1],
    ]);
  });

  it('leaves out what belongs to another session', () => {
    expect(descendantsOf(parsePs(PS), 83287).map((p) => p.pid)).not.toContain(90_000);
  });

  it('is empty for a pid that launched nothing', () => {
    expect(descendantsOf(parsePs(PS), 85_179)).toEqual([]);
  });

  it('is empty for a pid nobody reported', () => {
    expect(descendantsOf(parsePs(PS), 4242)).toEqual([]);
  });

  it('does not loop forever when a process claims itself as its parent', () => {
    const rows = parsePs(['10 10 5 100 self', '11 10 5 100 child'].join('\n'));
    expect(descendantsOf(rows, 10).map((p) => p.pid)).toEqual([11]);
  });

  it('does not loop forever on a cycle between two processes', () => {
    const rows = parsePs(['10 11 5 100 a', '11 10 5 100 b'].join('\n'));
    expect(descendantsOf(rows, 10).map((p) => p.pid)).toEqual([11]);
  });
});
