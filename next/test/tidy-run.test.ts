import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

const spawned: { bin: string; args: string[]; opts: unknown; child: FakeChild }[] = [];

vi.mock('node:child_process', () => ({
  spawn: (bin: string, args: string[], opts: unknown) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() }) as FakeChild;
    spawned.push({ bin, args, opts, child });
    return child;
  },
}));

const { findClaude, runClaude } = await import('../src/host/tidy');

/** Waits for `runClaude` to have started its child: it looks for the binary first. */
async function started(): Promise<FakeChild> {
  await vi.waitFor(() => expect(spawned.length).toBeGreaterThan(0));
  const last = spawned[spawned.length - 1];
  if (last === undefined) throw new Error('nothing spawned');
  return last.child;
}

beforeEach(() => {
  spawned.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the headless Claude Code run behind the tidying', () => {
  it('finds a binary to call: one of the usual places, or else the bare name for the PATH', async () => {
    const bin = await findClaude();
    expect(bin === 'claude' || bin.endsWith('/claude')).toBe(true);
  });

  it('runs on the subscription with no settings, no tool, no MCP and no session kept, from a temporary folder', async () => {
    const log = vi.fn();
    const run = runClaude('file these', log);
    const child = await started();
    child.stdout.emit('data', Buffer.from(JSON.stringify({ result: '{"moves":[]}' })));
    child.emit('close', 0);
    expect(await run).toBe('{"moves":[]}');
    const call = spawned[0];
    expect(call?.args).toEqual(expect.arrayContaining(['-p', 'file these', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json']));
    expect(call?.args[call.args.indexOf('--setting-sources') + 1]).toBe('');
    expect((call?.opts as { cwd: string }).cwd).not.toBe(process.cwd());
    expect(log).not.toHaveBeenCalled();
  });

  it('reads an answer that arrives in several chunks', async () => {
    const run = runClaude('p', vi.fn());
    const child = await started();
    const whole = JSON.stringify({ result: 'done' });
    child.stdout.emit('data', Buffer.from(whole.slice(0, 5)));
    child.stdout.emit('data', Buffer.from(whole.slice(5)));
    child.emit('close', 0);
    expect(await run).toBe('done');
  });

  it('gives no answer, and says why, when Claude Code answers an error', async () => {
    const log = vi.fn();
    const run = runClaude('p', log);
    const child = await started();
    child.stdout.emit('data', Buffer.from(JSON.stringify({ is_error: true, result: 'nope' })));
    child.emit('close', 1);
    expect(await run).toBeUndefined();
    expect(log).toHaveBeenCalledWith('tidy → Claude Code answered an error (exit 1)');
  });

  it('gives no answer when the result is not text', async () => {
    const log = vi.fn();
    const run = runClaude('p', log);
    const child = await started();
    child.stdout.emit('data', Buffer.from(JSON.stringify({ result: 3 })));
    child.emit('close', 0);
    expect(await run).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('gives no answer, with what stderr said, when the output is not JSON', async () => {
    const log = vi.fn();
    const run = runClaude('p', log);
    const child = await started();
    child.stdout.emit('data', Buffer.from('garbage'));
    child.stderr.emit('data', Buffer.from('command crashed'));
    child.emit('close', 2);
    expect(await run).toBeUndefined();
    expect(log).toHaveBeenCalledWith('tidy → unreadable answer (exit 2): command crashed');
  });

  it('gives no answer when Claude Code cannot even start', async () => {
    const log = vi.fn();
    const run = runClaude('p', log);
    const child = await started();
    child.emit('error', new Error('ENOENT'));
    expect(await run).toBeUndefined();
    expect(log).toHaveBeenCalledWith('tidy → could not start Claude Code (ENOENT)');
  });

  it('stops a run that says nothing for three minutes, and says so', async () => {
    const log = vi.fn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = runClaude('p', log);
    // The binary is looked for on the disk first: real I/O, then the timer starts.
    while (spawned.length === 0) await new Promise<void>((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(179_000);
    expect(log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await run).toBeUndefined();
    expect(spawned[0]?.child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(log).toHaveBeenCalledWith('tidy → no answer after 180 s');
  });
});
