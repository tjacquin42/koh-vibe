import { describe, expect, it } from 'vitest';
import { classify, copyableCommand, displayCommand, kindOf } from '../src/process/classify';
import { descendantsOf, parsePs } from '../src/process/scan';

const SNAPSHOT = '/Users/jack/.claude/shell-snapshots/snapshot-zsh-1789001593821-ptqxu0.sh';
const TOOL_SHELL = `/bin/zsh -c source ${SNAPSHOT} 2>/dev/null || true && eval 'pnpm dev --port 3000' < /dev/null && pwd -P >| /tmp/claude-1455-cwd`;

describe('kindOf', () => {
  it('calls a tool shell what it is, at any depth', () => {
    expect(kindOf({ command: TOOL_SHELL, depth: 0 })).toBe('shell');
    expect(kindOf({ command: TOOL_SHELL, depth: 2 })).toBe('shell');
  });

  it('takes a direct child that is not a shell for an MCP server', () => {
    expect(kindOf({ command: '/opt/homebrew/bin/uv tool uvx alpaca-mcp-server', depth: 0 })).toBe('mcp');
    expect(kindOf({ command: '/Applications/Spline.app/Contents/MacOS/Spline spline-mcp.cjs', depth: 0 })).toBe('mcp');
  });

  it('takes everything under a shell for work the session started', () => {
    expect(kindOf({ command: 'node vite', depth: 1 })).toBe('work');
    expect(kindOf({ command: 'sleep 45', depth: 3 })).toBe('work');
  });
});

describe('classify', () => {
  const TREE = parsePs(
    [
      '100   1  10 1000 /path/to/claude',
      '200 100  10 1000 /opt/homebrew/bin/uv tool uvx alpaca-mcp-server',
      '300 200  10 1000 /Users/jack/.cache/uv/bin/python -m alpaca_mcp',
      `400 100  10 1000 /bin/zsh -c source ${SNAPSHOT} && eval 'pnpm dev' < /dev/null`,
      '500 400  10 1000 node vite',
    ].join('\n'),
  );

  it('files what an MCP server itself started as part of that server', () => {
    const kinds = new Map(classify(descendantsOf(TREE, 100)).map((p) => [p.pid, p.kind]));
    // The python process IS the alpaca server — the `uv` above it only launched
    // it. Read on its own line it looks like work the user started, which is
    // exactly what the inheritance is here to prevent.
    expect(kinds.get(300)).toBe('mcp');
    expect(kinds.get(200)).toBe('mcp');
  });

  it('leaves what a tool shell started as work the session did', () => {
    const kinds = new Map(classify(descendantsOf(TREE, 100)).map((p) => [p.pid, p.kind]));
    expect(kinds.get(400)).toBe('shell');
    expect(kinds.get(500)).toBe('work');
  });

  it('carries a readable label on every row', () => {
    const shown = new Map(classify(descendantsOf(TREE, 100)).map((p) => [p.pid, p.label]));
    expect(shown.get(400)).toBe('pnpm dev');
    expect(shown.get(500)).toBe('node vite');
  });

  it('has nothing to say about an empty tree', () => {
    expect(classify([])).toEqual([]);
  });
});

describe('displayCommand', () => {
  it('pulls the real command out of a tool shell', () => {
    expect(displayCommand(TOOL_SHELL)).toBe('pnpm dev --port 3000');
  });

  it('keeps a multi-line command on one line', () => {
    const shell = `/bin/zsh -c source ${SNAPSHOT} && eval 'echo a\necho b' < /dev/null`;
    expect(displayCommand(shell)).toBe('echo a echo b');
  });

  it('falls back to the shell itself when there is no eval to read', () => {
    expect(displayCommand(`/bin/zsh -c source ${SNAPSHOT}`)).toBe('zsh');
  });

  it('shortens the leading binary path and keeps the arguments', () => {
    expect(displayCommand('/opt/homebrew/bin/uv tool uvx alpaca-mcp-server')).toBe('uv tool uvx alpaca-mcp-server');
    expect(displayCommand('node vite')).toBe('node vite');
  });

  it('trims a command too long to read, keeping its head', () => {
    const long = `node ${'x'.repeat(200)}`;
    const shown = displayCommand(long);
    expect(shown.length).toBeLessThanOrEqual(80);
    expect(shown.startsWith('node xxx')).toBe(true);
    expect(shown.endsWith('…')).toBe(true);
  });

  it('never returns an empty label', () => {
    expect(displayCommand('')).toBe('?');
    expect(displayCommand('   ')).toBe('?');
  });
});

describe('copyableCommand', () => {
  it('gives back a tool shell command whole, where the label had to cut it', () => {
    const long = `x --flag ${'y'.repeat(200)}`;
    const shell = `/bin/zsh -c source ${SNAPSHOT} && eval '${long}' < /dev/null`;
    expect(copyableCommand(shell)).toBe(long);
    expect(displayCommand(shell).endsWith('…')).toBe(true);
  });

  it('keeps the newlines of a multi-line command, which the label flattens', () => {
    // Flattening is right for a one-line row and WRONG for the clipboard:
    // `echo a\necho b` pasted as `echo a echo b` is a different command.
    const shell = `/bin/zsh -c source ${SNAPSHOT} && eval 'echo a\necho b' < /dev/null`;
    expect(copyableCommand(shell)).toBe('echo a\necho b');
    expect(displayCommand(shell)).toBe('echo a echo b');
  });

  it('keeps the full binary path of an ordinary process, which the label shortens', () => {
    const command = '/opt/homebrew/bin/uv tool uvx alpaca-mcp-server';
    expect(copyableCommand(command)).toBe(command);
    expect(displayCommand(command)).toBe('uv tool uvx alpaca-mcp-server');
  });

  it('is empty for an empty command, never the "?" the label falls back to', () => {
    // A row label needs something to draw; a clipboard does not, and pasting
    // a question mark into a terminal would be worse than pasting nothing.
    expect(copyableCommand('   ')).toBe('');
  });
});
