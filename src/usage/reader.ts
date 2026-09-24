import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { statusFile, usageFile } from '../paths';
import { parseUsage, type Usage } from './model';
import { fetchUsage, readAccessToken } from './oauth';

export type UsageSource = 'api' | 'statusline';

export interface UsageReading {
  usage: Usage;
  source: UsageSource;
  /** Last-write date of the file, to say how old the reading is. */
  at: number;
}

/**
 * Beyond this, we ask the API again. Below it, the shared cache is enough:
 * several windows render their tree every two seconds, and each one
 * querying the API to display the same figure would be as absurd as it
 * would be rude.
 */
export const REFRESH_AFTER_MS = 5 * 60_000;

async function reading(path: string, source: UsageSource): Promise<UsageReading | undefined> {
  try {
    const [raw, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    const usage = parseUsage(JSON.parse(raw) as unknown);
    return usage === undefined ? undefined : { usage, source, at: info.mtimeMs };
  } catch {
    return undefined;
  }
}

/**
 * Last ATTEMPT, per state root and for this process.
 *
 * Counting attempts rather than successes is the whole point: without
 * this, an unreachable API or a refused keychain produce no file, so
 * nothing to date — and the render, which runs every two seconds, would
 * fire off a `security` call and an HTTPS request on every pass. A failure
 * must cost as little as a success.
 */
const lastAttempt = new Map<string, number>();

/** Injectable so the pacing can be tested without a keychain or network. */
export interface UsageDeps {
  readToken: () => Promise<string | undefined>;
  fetch: (token: string) => Promise<unknown>;
  now: () => number;
}

const REAL_DEPS: UsageDeps = { readToken: readAccessToken, fetch: fetchUsage, now: () => Date.now() };

/** Resets the attempt counter to zero (tests). */
export function forgetAttempts(): void {
  lastAttempt.clear();
}

/**
 * Queries the API and caches the result. `force` bypasses the delay: that
 * is what the refresh button does, which would be pointless if it had to
 * wait for the deadline like an ordinary render.
 *
 * Never fails loudly: refused keychain, offline, changed endpoint — all of
 * that counts as "no new reading", and the old one stays displayed with its
 * age.
 */
export async function refreshFromApi(
  home: string,
  force: boolean,
  deps: UsageDeps = REAL_DEPS,
): Promise<UsageReading | undefined> {
  const cached = await reading(usageFile(home), 'api');
  const now = deps.now();
  if (!force) {
    if (now - (lastAttempt.get(home) ?? 0) < REFRESH_AFTER_MS) return cached;
    // Another window may have just done it for us: the cache is shared,
    // and two windows querying the API to display the same figure would be
    // an expense for nothing.
    if (cached !== undefined && now - cached.at < REFRESH_AFTER_MS) return cached;
  }
  lastAttempt.set(home, now);

  const token = await deps.readToken();
  if (token === undefined) return cached;
  const raw = await deps.fetch(token);
  if (parseUsage(raw) === undefined) return cached;

  // Atomic write: another window may read while we write — same rule as
  // the spool and the folder listing.
  const target = usageFile(home);
  const tmp = join(dirname(target), `.tmp-usage-${process.pid}`);
  try {
    await writeFile(tmp, JSON.stringify(raw), 'utf8');
    await rename(tmp, target);
  } catch {
    // The reading is worth displaying even if we failed to keep it.
  }
  return (await reading(target, 'api')) ?? cached;
}

/**
 * The FRESHEST of the two local readings, never the first one found.
 *
 * A fixed priority order would display a stale figure as soon as the
 * preferred source falls silent — and each falls silent in turn: the
 * status line does not trigger in a session hosted by the editor, and the
 * API can be out of reach.
 */
export async function readUsage(home: string): Promise<UsageReading | undefined> {
  const [api, line] = await Promise.all([
    reading(usageFile(home), 'api'),
    reading(statusFile(home), 'statusline'),
  ]);
  if (api === undefined) return line;
  if (line === undefined) return api;
  return line.at > api.at ? line : api;
}
