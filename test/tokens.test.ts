import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleInterrupted, withTokens } from '../src/transcript/tokens';
import type { Session } from '../src/events/types';
import type { TranscriptStats } from '../src/transcript/reader';

let dir: string;
let goodFile: string;
let brokenDir: string; // a folder passed as if it were a transcript file

const assistant = (input: number, output: number): string =>
  `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: input, output_tokens: output } } })}\n`;

const session = (id: string, transcriptPath: string): Session => ({
  id,
  cwd: '/x',
  project: 'x',
  origin: 'vscode',
  status: 'running',
  toolCount: 0,
  lastEventAt: 1,
  transcriptPath,
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'koh-tokens-'));
  goodFile = join(dir, 'good.jsonl');
  brokenDir = join(dir, 'broken.jsonl'); // a real folder: readTranscript throws EISDIR when read
  await writeFile(goodFile, assistant(100, 20));
  const { mkdirSync } = await import('node:fs');
  mkdirSync(brokenDir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('withTokens', () => {
  it('isolates failures per session: an unreadable session does not deprive the others of their counters', async () => {
    const sessions = new Map<string, Session>([
      ['good', session('good', goodFile)],
      ['bad', session('bad', brokenDir)],
    ]);
    const onFailure = vi.fn();

    const out = await withTokens(sessions, new Map<string, TranscriptStats>(), onFailure);

    expect(out.get('good')?.tokens).toEqual({ input: 100, output: 20 });
    expect(out.get('bad')?.tokens).toBeUndefined();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0]).toBe(out.get('bad'));
  });

  it('never throws, even when the only session present fails', async () => {
    const sessions = new Map<string, Session>([['bad', session('bad', brokenDir)]]);
    await expect(withTokens(sessions, new Map<string, TranscriptStats>())).resolves.toBeDefined();
  });

  it('the next render still works: a second call after a failure still succeeds, for the healthy session as much as for the faulty one', async () => {
    const sessions = new Map<string, Session>([
      ['good', session('good', goodFile)],
      ['bad', session('bad', brokenDir)],
    ]);
    const transcripts = new Map<string, TranscriptStats>();
    const onFailure = vi.fn();

    await withTokens(sessions, transcripts, onFailure);
    // A second "tick" on the same state, as the timer would do 2s later.
    const out = await withTokens(sessions, transcripts, onFailure);

    expect(out.get('good')?.tokens).toEqual({ input: 100, output: 20 });
    expect(out.get('bad')?.tokens).toBeUndefined();
    expect(onFailure).toHaveBeenCalledTimes(2); // once per call, never swallowed
  });

  it('never calls onFailure for a session without a transcript', async () => {
    const sessions = new Map<string, Session>([['idle', { ...session('idle', ''), transcriptPath: undefined }]]);
    const onFailure = vi.fn();
    await withTokens(sessions, new Map<string, TranscriptStats>(), onFailure);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('copies the transcript title back onto the session', async () => {
    const titleFile = join(dir, 'title.jsonl');
    await writeFile(titleFile, `${JSON.stringify({ type: 'custom-title', customTitle: '#Mon titre' })}\n${assistant(10, 5)}`);
    const sessions = new Map<string, Session>([['a', session('a', titleFile)]]);

    const out = await withTokens(sessions, new Map<string, TranscriptStats>(), () => {});

    expect(out.get('a')?.title).toBe('#Mon titre');
  });
});

describe('settleInterrupted (21/11)', () => {
  const waiting = (): Session => ({
    ...session('q', '/t'),
    status: 'waiting',
    lastEventAt: 1_000,
    pendingPermission: { tool: 'AskUserQuestion', summary: 'Question' },
    inFlightSince: 900,
    currentAction: { tool: 'AskUserQuestion' },
  });

  it('rests a conversation stopped after its last hook', () => {
    const s = waiting();
    settleInterrupted(s, 2_000);
    expect(s.status).toBe('idle');
    expect(s.pendingPermission).toBeUndefined();
    expect(s.inFlightSince).toBeUndefined();
    expect(s.currentAction).toBeUndefined();
  });

  it('does the same for one stopped with Escape while it worked', () => {
    const s = { ...waiting(), status: 'running' as const };
    settleInterrupted(s, 2_000);
    expect(s.status).toBe('idle');
  });

  it('leaves alone what a later hook set, no interruption, an ended one and the other states', () => {
    const later = waiting();
    settleInterrupted(later, 1_000);
    expect(later.status).toBe('waiting');
    const none = waiting();
    settleInterrupted(none, undefined);
    expect(none.status).toBe('waiting');
    const ended = { ...waiting(), endedAt: 1_500 };
    settleInterrupted(ended, 2_000);
    expect(ended.status).toBe('waiting');
    const unread = { ...waiting(), status: 'done_unseen' as const };
    settleInterrupted(unread, 2_000);
    expect(unread.status).toBe('done_unseen');
  });

  it('is applied by withTokens from the transcript', async () => {
    const path = join(dir, 'q.jsonl');
    await writeFile(path, `${JSON.stringify({ type: 'user', timestamp: '2026-11-21T14:05:56.146Z', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } })}\n`);
    const s = { ...waiting(), transcriptPath: path };
    await withTokens(new Map([['q', s]]), new Map());
    expect(s.status).toBe('idle');
  });
});
