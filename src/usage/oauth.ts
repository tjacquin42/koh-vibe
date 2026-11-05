import { execFile } from 'node:child_process';
import { request } from 'node:https';
import { isRecord } from '../lib/json';

/**
 * Usage, requested directly from Anthropic.
 *
 * Why this path rather than the statusline bridge: Claude Code only passes
 * `rate_limits` to the statusline, and the statusline never fires in a
 * session hosted by the editor — measured, the file stayed empty. This path
 * depends on no other application.
 *
 * The token is the one Claude Code has already deposited in the session's
 * keychain: we don't authenticate on its behalf, we reuse its
 * authentication. It is never written to disk, never logged, and never
 * leaves this module.
 */
const SERVICE = 'Claude Code-credentials';
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const TIMEOUT_MS = 8_000;

/**
 * The access token, or `undefined` if it cannot be obtained — locked
 * keychain, authorization refused, Claude Code authenticated some other
 * way, or simply another platform. None of these cases is an error: the
 * view shows « unknown » and carries on.
 *
 * `execFile`, never `exec`: none of this must ever go through a shell.
 */
export function readAccessToken(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-w'], (err, stdout) => {
      if (err) return resolve(undefined);
      resolve(accessTokenOf(stdout));
    });
  });
}

/**
 * Extracts the token from the keychain's JSON. Kept separate from the read
 * so it can be tested without a keychain — and without ever needing a real
 * token.
 */
export function accessTokenOf(raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const oauth = parsed['claudeAiOauth'];
  if (!isRecord(oauth)) return undefined;
  const token = oauth['accessToken'];
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/**
 * Queries the usage endpoint. Any response that isn't usable JSON counts as
 * `undefined`: this endpoint isn't documented and can change without
 * notice, which must translate into « no measurement », never into a
 * displayed error nor an exception bubbling up into the render.
 */
export function fetchUsage(token: string, url: string = USAGE_URL): Promise<unknown> {
  return new Promise((resolve) => {
    const done = (value: unknown): void => resolve(value);
    const req = request(
      url,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          accept: 'application/json',
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return done(undefined);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            done(JSON.parse(body) as unknown);
          } catch {
            done(undefined);
          }
        });
      },
    );
    req.on('error', () => done(undefined));
    req.on('timeout', () => {
      req.destroy();
      done(undefined);
    });
    req.end();
  });
}
