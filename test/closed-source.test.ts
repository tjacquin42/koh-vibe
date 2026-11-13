import { describe, expect, it } from 'vitest';
import { closedSource, type ReadTranscript } from '../src/closed/source';
import type { Session } from '../src/events/types';
import type { TranscriptStats } from '../src/transcript/reader';

const PATH = '/Users/dev/.claude/projects/-Users-dev-projet/a.jsonl';

/** A session as it is read off disk: no title, no branch — those live in the render's cache. */
function onDisk(over: Partial<Session> = {}): Session {
  return {
    id: 'a',
    cwd: '/Users/dev/projet',
    project: 'projet',
    origin: 'vscode',
    status: 'idle',
    toolCount: 0,
    lastEventAt: 1,
    transcriptPath: PATH,
    ...over,
  };
}

const stats = (over: Partial<TranscriptStats> = {}): TranscriptStats => ({ offset: 0, input: 0, output: 0, ...over });

/** A reader that records its calls and answers `answer`, or throws when told to. */
function reader(answer: TranscriptStats | 'throws') {
  const calls: Array<[string, TranscriptStats | undefined]> = [];
  const read: ReadTranscript = async (path, from) => {
    calls.push([path, from]);
    if (answer === 'throws') throw new Error('EACCES');
    return answer;
  };
  return { read, calls };
}

describe('closedSource', () => {
  it('reads the title from the transcript when the render has not read it yet — the window just loaded', async () => {
    const { read, calls } = reader(stats({ title: 'Vortex Kids', branch: 'feat/x' }));
    expect(await closedSource(onDisk(), undefined, read)).toMatchObject({ title: 'Vortex Kids', branch: 'feat/x' });
    expect(calls).toEqual([[PATH, undefined]]);
  });

  it('reads on from where the render stopped, so a title set since then is not missed', async () => {
    const cached = stats({ offset: 120 });
    const { read, calls } = reader(stats({ offset: 300, title: 'Named since' }));
    expect((await closedSource(onDisk(), cached, read)).title).toBe('Named since');
    expect(calls).toEqual([[PATH, cached]]);
  });

  it('keeps a title the session already carries, without reading anything', async () => {
    const { read, calls } = reader(stats({ title: 'Other' }));
    expect((await closedSource(onDisk({ title: 'Mine' }), undefined, read)).title).toBe('Mine');
    expect(calls).toEqual([]);
  });

  it('archives the conversation nameless rather than not at all when the read fails', async () => {
    const { read } = reader('throws');
    const source = await closedSource(onDisk(), stats({ branch: 'dev' }), read);
    expect(source.title).toBeUndefined();
    expect(source.branch).toBe('dev');
  });

  it('takes what the cache has when there is no transcript to read', async () => {
    const { read, calls } = reader(stats({ title: 'Unused' }));
    const source = await closedSource(onDisk({ transcriptPath: undefined }), stats({ title: 'Cached' }), read);
    expect(source.title).toBe('Cached');
    expect(calls).toEqual([]);
  });

  it('keeps a branch the session carries over the one the transcript names', async () => {
    const { read } = reader(stats({ title: 'T', branch: 'from-transcript' }));
    expect((await closedSource(onDisk({ branch: 'worktree-branch' }), undefined, read)).branch).toBe('worktree-branch');
  });
});
