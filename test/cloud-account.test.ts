import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { organizationOf, readCredentials, readOrganization } from '../src/cloud/account';

describe('organizationOf', () => {
  it('reads the organization Claude Code is signed in to', () => {
    expect(organizationOf(JSON.stringify({ oauthAccount: { organizationUuid: 'org-test' } }))).toBe('org-test');
  });

  it('returns undefined for anything else', () => {
    for (const raw of [
      '',
      'pas du JSON',
      '[]',
      '{}',
      JSON.stringify({ oauthAccount: {} }),
      JSON.stringify({ oauthAccount: { organizationUuid: '' } }),
      JSON.stringify({ oauthAccount: { organizationUuid: 42 } }),
    ]) {
      expect(organizationOf(raw)).toBeUndefined();
    }
  });
});

describe('readOrganization', () => {
  it('reads it from the file, and takes a missing file for no organization', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'koh-account-')), '.claude.json');
    expect(await readOrganization(file)).toBeUndefined();
    await writeFile(file, JSON.stringify({ oauthAccount: { organizationUuid: 'org-test' } }), 'utf8');
    expect(await readOrganization(file)).toBe('org-test');
  });
});

describe('readCredentials', () => {
  it('needs a token, and makes do without an organization', async () => {
    expect(await readCredentials({ readToken: async () => 'tok', readOrganization: async () => 'org-test' })).toEqual({
      token: 'tok',
      organization: 'org-test',
    });
    expect(await readCredentials({ readToken: async () => 'tok', readOrganization: async () => undefined })).toEqual({
      token: 'tok',
      organization: undefined,
    });
  });

  it('does not even open the configuration when there is no token', async () => {
    let opened = 0;
    const result = await readCredentials({
      readToken: async () => undefined,
      readOrganization: async () => {
        opened += 1;
        return 'org-test';
      },
    });
    expect(result).toBeUndefined();
    expect(opened).toBe(0);
  });
});
