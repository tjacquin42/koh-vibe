import { readFile } from 'node:fs/promises';
import { isRecord, nonEmptyString } from '../lib/json';
import { claudeConfigFile } from '../paths';
import { readAccessToken } from '../usage/oauth';
import { send, type Send } from './request';

/**
 * Who Koh-Vibe talks to claude.ai as: the token Claude Code keeps in the
 * keychain, and the organization it is signed in to. We never sign in on our
 * own; we reuse what Claude Code holds, read at the moment of each request and
 * kept nowhere.
 */
export interface Credentials {
  token: string;
  /** `undefined` when Claude Code is not signed in to a claude.ai account — an API key, say. */
  organization: string | undefined;
}

/** The organization in Claude Code's global configuration, or `undefined` for anything else. */
export function organizationOf(raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const account = parsed['oauthAccount'];
  return isRecord(account) ? nonEmptyString(account['organizationUuid']) : undefined;
}

/** Never throws: an absent or unreadable file is an unknown organization. */
export async function readOrganization(file: string = claudeConfigFile()): Promise<string | undefined> {
  try {
    return organizationOf(await readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export interface CredentialDeps {
  readToken: () => Promise<string | undefined>;
  readOrganization: () => Promise<string | undefined>;
}

const REAL: CredentialDeps = { readToken: readAccessToken, readOrganization: () => readOrganization() };

/**
 * The token, then the organization — or `undefined` without a token, in which
 * case the configuration file is not even opened: nothing can be asked of
 * claude.ai anyway.
 */
export async function readCredentials(deps: CredentialDeps = REAL): Promise<Credentials | undefined> {
  const token = await deps.readToken();
  if (token === undefined) return undefined;
  return { token, organization: await deps.readOrganization() };
}

/** What every cloud call needs — injectable, so none of them needs a keychain or a network in tests. */
export interface CloudDeps {
  send: Send;
  credentials: () => Promise<Credentials | undefined>;
}

export const CLOUD: CloudDeps = { send, credentials: () => readCredentials() };
