import { describe, expect, it } from 'vitest';
import type { CloudDeps } from '../../src/cloud/account';
import type { CloudRequest } from '../../src/cloud/request';
import { deleteArtifact } from '../src/host/cloud';

function cloud(status: number | undefined, organization?: string): CloudDeps & { sent: CloudRequest[] } {
  const sent: CloudRequest[] = [];
  return {
    sent,
    credentials: async () => ({ token: 'tok', organization }),
    send: async (req) => {
      sent.push(req);
      return status === undefined ? undefined : { status, body: undefined };
    },
  };
}

describe('deleting an artifact on claude.ai', () => {
  it('asks for that page and no other, signed, in the user’s organisation', async () => {
    const c = cloud(204, 'org-1');
    expect(await deleteArtifact('abc-123', c)).toBe(true);
    expect(c.sent).toHaveLength(1);
    const req = c.sent[0];
    expect(req?.method).toBe('DELETE');
    expect(req?.url.endsWith('/api/frame/abc-123')).toBe(true);
    expect(req?.headers['authorization']).toBe('Bearer tok');
    expect(req?.headers['x-organization-uuid']).toBe('org-1');
  });

  it('sends no organisation it does not know', async () => {
    const c = cloud(204);
    await deleteArtifact('abc-123', c);
    expect(c.sent[0]?.headers).not.toHaveProperty('x-organization-uuid');
  });

  it('says no when claude.ai refuses, does not answer, or nobody is signed in', async () => {
    expect(await deleteArtifact('abc-123', cloud(404))).toBe(false);
    expect(await deleteArtifact('abc-123', cloud(500))).toBe(false);
    expect(await deleteArtifact('abc-123', cloud(undefined))).toBe(false);
    const signedOut: CloudDeps & { sent: CloudRequest[] } = { ...cloud(204), credentials: async () => undefined };
    expect(await deleteArtifact('abc-123', signedOut)).toBe(false);
    expect(signedOut.sent).toEqual([]);
  });

  it('never lets a slug out of its place in the address', async () => {
    const c = cloud(204);
    await deleteArtifact('../../account', c);
    expect(c.sent[0]?.url.endsWith('/api/frame/..%2F..%2Faccount')).toBe(true);
  });
});
