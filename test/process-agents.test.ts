import { describe, expect, it } from 'vitest';
import { AgentIndex, agentKey, withAgents } from '../src/process/agents';
import type { SpoolEvent } from '../src/events/types';
import { classify, copyableCommand } from '../src/process/classify';
import { descendantsOf, parsePs } from '../src/process/scan';

const ev = (over: Partial<SpoolEvent>): SpoolEvent => ({
  event: 'PreToolUse',
  at: 1000,
  entrypoint: 'claude-vscode',
  termProgram: '',
  sessionId: 's1',
  cwd: '/tmp',
  toolName: 'Bash',
  toolTarget: 'pnpm dev',
  agentId: 'a75a44d961c4d575b',
  agentType: 'general-purpose',
  ...over,
});

describe('agentKey', () => {
  it('collapses every run of whitespace, as the spool already does', () => {
    // Both sides have to agree on the text, or nothing ever matches: the spool
    // normalises a command before storing it, and the process table reports it
    // with its own spacing.
    expect(agentKey('pnpm   dev\n--port 3000')).toBe(agentKey('pnpm dev --port 3000'));
  });

  it('cuts at the same length the spool cuts, so a long command still matches', () => {
    const long = `node ${'x'.repeat(200)}`;
    expect(agentKey(long)).toBe(agentKey(`${long} and more`));
  });

  it('is empty for an empty command, which never matches anything', () => {
    expect(agentKey('   ')).toBe('');
  });

  it('joins a real tool shell to the real payload of the same command', () => {
    // Both sides captured from a running subagent, not invented. This is the
    // whole join: no identifier ties a hook event to a process, so if these
    // two ever stop agreeing, nothing is ever marked and nothing says why.
    const shell =
      '/bin/zsh -c source /Users/jack/.claude/shell-snapshots/snapshot-zsh-1789074148577-235peq.sh 2>/dev/null || true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null || true && eval \'python3 -c "import time; time.sleep(70)  # koh-vibe-marker-eta"\' < /dev/null && pwd -P >| /tmp/claude-1455-cwd';
    const fromHook = 'python3 -c "import time; time.sleep(70) # koh-vibe-marker-eta"';
    expect(agentKey(copyableCommand(shell))).toBe(agentKey(fromHook));
  });
});

describe('AgentIndex', () => {
  it('remembers the agent behind a command it is about to run', () => {
    const index = new AgentIndex();
    index.note(ev({}));
    expect(index.markOf('pnpm dev')?.id).toBe('a75a44d961c4d575b');
    expect(index.markOf('pnpm dev')?.type).toBe('general-purpose');
  });

  it('knows nothing about a command no agent ran', () => {
    const index = new AgentIndex();
    index.note(ev({}));
    expect(index.markOf('pnpm build')).toBeUndefined();
  });

  it('ignores an event with no agent — the main conversation runs commands too', () => {
    const index = new AgentIndex();
    index.note(ev({ agentId: undefined, agentType: undefined }));
    expect(index.markOf('pnpm dev')).toBeUndefined();
  });

  it('ignores a tool that starts no process', () => {
    const index = new AgentIndex();
    index.note(ev({ toolName: 'Read', toolTarget: '/tmp/x.ts' }));
    expect(index.markOf('/tmp/x.ts')).toBeUndefined();
  });

  it('forgets a command once it has finished', () => {
    // Otherwise the next identical command, run by the main conversation,
    // would inherit the mark of an agent that is long gone.
    const index = new AgentIndex();
    index.note(ev({}));
    index.note(ev({ event: 'PostToolUse' }));
    expect(index.markOf('pnpm dev')).toBeUndefined();
  });

  it('matches a command whose spacing differs from the spool text', () => {
    const index = new AgentIndex();
    index.note(ev({ toolTarget: 'echo a b' }));
    expect(index.markOf('echo   a\n  b')).toBeDefined();
  });

  it('keeps the most recent claim when two agents run the same command', () => {
    // Indistinguishable by design — the command is the only link. The later
    // one wins, which at worst puts the right icon on the wrong row of two
    // identical rows.
    const index = new AgentIndex();
    index.note(ev({ agentId: 'first' }));
    index.note(ev({ agentId: 'second' }));
    expect(index.markOf('pnpm dev')?.id).toBe('second');
  });

  it('drops a claim nothing ever closed', () => {
    // A session that dies mid-command sends no closing event. Without an
    // expiry, its claim would mark an unrelated command for the life of the
    // window.
    const index = new AgentIndex();
    index.note(ev({ at: 1000 }));
    index.prune(1000 + 7 * 60 * 60 * 1000);
    expect(index.markOf('pnpm dev')).toBeUndefined();
  });

  it('keeps a claim that is merely long-running', () => {
    const index = new AgentIndex();
    index.note(ev({ at: 1000 }));
    index.prune(1000 + 60_000);
    expect(index.markOf('pnpm dev')).toBeDefined();
  });
});

describe('withAgents', () => {
  const SNAPSHOT = '/Users/jack/.claude/shell-snapshots/snap.sh';
  const procs = () =>
    classify(
      descendantsOf(
        parsePs(
          [
            '100   1  10 1000 /path/to/claude',
            `200 100  10 1000 /bin/zsh -c source ${SNAPSHOT} && eval 'pnpm dev' < /dev/null`,
            '201 200  10 1000 node vite',
            `300 100  10 1000 /bin/zsh -c source ${SNAPSHOT} && eval 'pnpm build' < /dev/null`,
          ].join('\n'),
        ),
        100,
      ),
    );

  const indexWith = (command: string): AgentIndex => {
    const index = new AgentIndex();
    index.note(ev({ toolTarget: command }));
    return index;
  };

  it('marks the shell of a command an agent ran', () => {
    const marked = withAgents(new Map([['s1', procs()]]), indexWith('pnpm dev'));
    const byPid = new Map((marked.get('s1') ?? []).map((p) => [p.pid, p]));
    expect(byPid.get(200)?.agent?.id).toBe('a75a44d961c4d575b');
  });

  it('marks what that command started, down the whole subtree', () => {
    // The server is the agent's doing as much as the shell above it, and it is
    // the row a reader actually looks at.
    const marked = withAgents(new Map([['s1', procs()]]), indexWith('pnpm dev'));
    const byPid = new Map((marked.get('s1') ?? []).map((p) => [p.pid, p]));
    expect(byPid.get(201)?.agent?.id).toBe('a75a44d961c4d575b');
  });

  it('leaves the commands the conversation ran itself unmarked', () => {
    const marked = withAgents(new Map([['s1', procs()]]), indexWith('pnpm dev'));
    const byPid = new Map((marked.get('s1') ?? []).map((p) => [p.pid, p]));
    expect(byPid.get(300)?.agent).toBeUndefined();
  });

  it('returns the very same map when nothing matches, so nothing redraws', () => {
    const before = new Map([['s1', procs()]]);
    expect(withAgents(before, indexWith('pnpm test'))).toBe(before);
  });
});
