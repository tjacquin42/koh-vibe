import { describe, expect, it } from 'vitest';
import { listArtifacts } from '../src/artifacts/api';
import type { CloudDeps, Credentials } from '../src/cloud/account';
import type { CloudRequest, CloudResponse } from '../src/cloud/request';

const SIGNED: Credentials = { token: 'tok', organization: 'org-test' };

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

describe('listArtifacts', () => {
  it('asks for one page of the listing with the token, the OAuth beta and the organization', async () => {
    const { deps, sent } = fake({ status: 200, body: { frames: [], starsEnabled: true } });
    expect(await listArtifacts(deps)).toEqual({ kind: 'ok', items: [], truncated: false });
    expect(sent).toEqual([
      {
        method: 'GET',
        url: 'https://api.anthropic.com/api/frame/frames?limit=200',
        headers: { authorization: 'Bearer tok', 'anthropic-beta': 'oauth-2025-04-20', 'x-organization-uuid': 'org-test' },
      },
    ]);
  });

  it('makes do without an organization', async () => {
    const { deps, sent } = fake({ status: 200, body: { frames: [] } }, { token: 'tok', organization: undefined });
    await listArtifacts(deps);
    expect(sent[0]?.headers).toEqual({ authorization: 'Bearer tok', 'anthropic-beta': 'oauth-2025-04-20' });
  });

  it('is signed out without a token, and sends nothing', async () => {
    const { deps, sent } = fake({ status: 200, body: { frames: [] } }, 'signed-out');
    expect(await listArtifacts(deps)).toEqual({ kind: 'signed-out' });
    expect(sent).toEqual([]);
  });

  it('is unavailable on anything but a 200 carrying the listing', async () => {
    for (const response of [undefined, { status: 403, body: {} }, { status: 200, body: undefined }, { status: 200, body: { frames: 'x' } }]) {
      expect(await listArtifacts(fake(response).deps)).toEqual({ kind: 'unavailable' });
    }
  });
});
