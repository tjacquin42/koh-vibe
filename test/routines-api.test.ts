import { describe, expect, it } from 'vitest';
import type { CloudDeps, Credentials } from '../src/cloud/account';
import type { CloudRequest, CloudResponse } from '../src/cloud/request';
import { listRoutines, runRoutine, setRoutineEnabled } from '../src/routines/api';

const SIGNED: Credentials = { token: 'tok', organization: 'org-test' };

/** A client that records what it is sent and answers `response`. */
function fake(response: CloudResponse | undefined, signedIn: Credentials | 'signed-out' = SIGNED) {
  const sent: CloudRequest[] = [];
  const deps: CloudDeps = {
    send: async (req) => {
      sent.push(req);
      return response;
    },
    credentials: async () => (signedIn === 'signed-out' ? undefined : signedIn),
  };
  return { deps, sent };
}

const LIST = {
  data: [{ id: 'trig_test_01', name: 'Digest', enabled: true, cron_expression: '0 6 * * *' }],
  has_more: false,
};

describe('listRoutines', () => {
  it('asks for the routines with the token, the triggers beta and the organization', async () => {
    const { deps, sent } = fake({ status: 200, body: LIST });
    expect(await listRoutines(deps)).toMatchObject({ kind: 'ok', truncated: false, items: [{ id: 'trig_test_01' }] });
    expect(sent).toEqual([
      {
        method: 'GET',
        url: 'https://api.anthropic.com/v1/code/triggers',
        headers: {
          authorization: 'Bearer tok',
          'anthropic-beta': 'ccr-triggers-2026-01-30',
          'x-organization-uuid': 'org-test',
        },
        expects: expect.any(Function),
      },
    ]);
  });

  it('tells the log what a usable answer looks like, so a changed shape is named there', async () => {
    const { deps, sent } = fake({ status: 200, body: LIST });
    await listRoutines(deps);
    const expects = sent[0]?.expects;
    expect(expects?.(LIST)).toBe(true);
    expect(expects?.({ data: 'x' })).toBe(false);
    expect(expects?.({ triggers: [] })).toBe(false);
  });

  it('is signed out without a token, or without a claude.ai organization — and sends nothing', async () => {
    for (const signedIn of ['signed-out', { token: 'tok', organization: undefined }] as const) {
      const { deps, sent } = fake({ status: 200, body: LIST }, signedIn);
      expect(await listRoutines(deps)).toEqual({ kind: 'signed-out' });
      expect(sent).toEqual([]);
    }
  });

  it('is unavailable on anything but a 200 carrying the list', async () => {
    for (const response of [
      undefined,
      { status: 401, body: undefined },
      { status: 500, body: LIST },
      { status: 200, body: undefined },
      { status: 200, body: { data: 'x' } },
    ]) {
      expect(await listRoutines(fake(response).deps)).toEqual({ kind: 'unavailable' });
    }
  });
});

describe('runRoutine', () => {
  it('posts an empty body to the run endpoint, the id escaped', async () => {
    const { deps, sent } = fake({ status: 200, body: {} });
    expect(await runRoutine('trig/01', deps)).toBe(true);
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.anthropic.com/v1/code/triggers/trig%2F01/run',
      body: {},
    });
    expect(sent[0]?.headers['x-organization-uuid']).toBe('org-test');
  });

  it('succeeds on any 2xx, fails on anything else, and sends nothing signed out', async () => {
    expect(await runRoutine('a', fake({ status: 201, body: undefined }).deps)).toBe(true);
    expect(await runRoutine('a', fake({ status: 409, body: {} }).deps)).toBe(false);
    expect(await runRoutine('a', fake(undefined).deps)).toBe(false);
    const { deps, sent } = fake({ status: 200, body: {} }, 'signed-out');
    expect(await runRoutine('a', deps)).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('setRoutineEnabled', () => {
  it('sends a partial update carrying only the switch', async () => {
    const { deps, sent } = fake({ status: 200, body: {} });
    expect(await setRoutineEnabled('trig_test_01', false, deps)).toBe(true);
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.anthropic.com/v1/code/triggers/trig_test_01',
      body: { enabled: false },
    });
  });
});
