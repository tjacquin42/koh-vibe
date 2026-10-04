import { describe, expect, it } from 'vitest';
import { childrenOf, mcpOf, processCount, processDescription, processTooltip, rootsOf, PROCESS_GLYPH } from '../src/ui/process-labels';
import { classify } from '../src/process/classify';
import { descendantsOf, parsePs, tableOf } from '../src/process/scan';

const SNAPSHOT = '/Users/jack/.claude/shell-snapshots/snap.sh';

const TREE = classify(
  descendantsOf(
    tableOf(parsePs(
      [
        '100   1     10 1000 /path/to/claude',
        '200 100  02:00 8000 /opt/homebrew/bin/uv tool uvx alpaca-mcp-server',
        '300 200  02:00 4000 /Users/jack/.cache/uv/bin/python -m alpaca_mcp',
        `400 100  01:30 1000 /bin/zsh -c source ${SNAPSHOT} && eval 'pnpm dev' < /dev/null`,
        '500 400  01:30 210000 node vite',
      ].join('\n'),
    )),
    100,
  ),
);

describe('rootsOf and childrenOf', () => {
  it('takes for roots the work the session started, leaving its servers out', () => {
    // The MCP servers moved to the Processes view: under a session they were
    // identical rows repeated in every conversation, burying the work that
    // actually differs from one to the next.
    expect(rootsOf(TREE).map((p) => p.pid)).toEqual([400]);
  });

  it('keeps the servers reachable, for the view that does show them', () => {
    expect(mcpOf(TREE).map((p) => p.pid)).toEqual([200, 300]);
  });

  it('finds what one process started', () => {
    expect(childrenOf(TREE, 400).map((p) => p.pid)).toEqual([500]);
    expect(childrenOf(TREE, 500)).toEqual([]);
  });
});

describe('processCount', () => {
  it('counts the work, not the MCP servers that are always there', () => {
    // Counting them would put the same number on every session for its whole
    // life, which tells the reader nothing.
    expect(processCount(TREE)).toBe(2);
  });

  it('is zero for a session running only its servers', () => {
    expect(processCount(TREE.filter((p) => p.kind === 'mcp'))).toBe(0);
  });
});

describe('processDescription', () => {
  it('says how long a process has been up, coarsely', () => {
    const shell = TREE.find((p) => p.pid === 400);
    expect(processDescription(shell!)).toBe('1 min');
  });

  it('names an MCP server, which nothing else on the row would say', () => {
    const mcp = TREE.find((p) => p.pid === 200);
    expect(processDescription(mcp!)).toBe('MCP · 2 min');
  });
});

describe('processTooltip', () => {
  it('carries the full command line the label had to cut', () => {
    const mcp = TREE.find((p) => p.pid === 200);
    expect(processTooltip(mcp!)).toContain('/opt/homebrew/bin/uv tool uvx alpaca-mcp-server');
  });

  it('carries the pid, which is what the user needs to act outside the editor', () => {
    expect(processTooltip(TREE.find((p) => p.pid === 500)!)).toContain('500');
  });

  it('carries the memory, rounded to something readable', () => {
    expect(processTooltip(TREE.find((p) => p.pid === 500)!)).toContain('205 MB');
  });
});

describe('PROCESS_GLYPH', () => {
  it('gives each kind a glyph of its own', () => {
    const glyphs = new Set(Object.values(PROCESS_GLYPH));
    expect(glyphs.size).toBe(3);
  });

  it('never uses the two icon names VSCode hands to the file-icon theme', () => {
    // `folder` and `file` are special-cased by VSCode and draw NOTHING under a
    // "None" icon theme — the trap the folder rows already documented.
    expect(Object.values(PROCESS_GLYPH)).not.toContain('folder');
    expect(Object.values(PROCESS_GLYPH)).not.toContain('file');
  });
});
