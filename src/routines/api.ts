import { CLOUD, type CloudDeps } from '../cloud/account';
import type { Fetched } from '../cloud/feed';
import { API_ORIGIN } from '../cloud/request';
import { parseRoutines, type Routine } from './model';

/**
 * The routines endpoints, called as Claude Code's own `RemoteTrigger` tool
 * calls them — read in its 2.1.282 bundle, documented nowhere. If they move,
 * the view says « unavailable » and the output channel says which call broke;
 * nothing throws.
 */
const TRIGGERS = `${API_ORIGIN}/v1/code/triggers`;
const BETA = 'ccr-triggers-2026-01-30';
/**
 * Never written in the tool's call: its HTTP client adds it for the auth mode
 * the call names (`teleport-org`), along with the token and the organization —
 * so a copy of the call alone misses it, as this module first did. Sent on
 * every call, as that client does.
 */
const VERSION = '2023-06-01';

interface SignedIn {
  token: string;
  organization: string;
}

/**
 * The organization is not optional here: the endpoint answers for one, and a
 * Claude Code signed in with an API key has none to give.
 */
async function signedIn(deps: CloudDeps): Promise<SignedIn | undefined> {
  const c = await deps.credentials();
  if (c === undefined || c.organization === undefined) return undefined;
  return { token: c.token, organization: c.organization };
}

function headers(s: SignedIn): Record<string, string> {
  return {
    authorization: `Bearer ${s.token}`,
    'anthropic-version': VERSION,
    'anthropic-beta': BETA,
    'x-organization-uuid': s.organization,
  };
}

export async function listRoutines(deps: CloudDeps = CLOUD): Promise<Fetched<Routine>> {
  const s = await signedIn(deps);
  if (s === undefined) return { kind: 'signed-out' };
  const res = await deps.send({
    method: 'GET',
    url: TRIGGERS,
    headers: headers(s),
    expects: (body) => parseRoutines(body) !== undefined,
  });
  // A 401 is not told apart: Claude Code renews its token by itself, and the
  // next attempt reads the new one.
  if (res === undefined || res.status !== 200) return { kind: 'unavailable' };
  const list = parseRoutines(res.body);
  return list === undefined ? { kind: 'unavailable' } : { kind: 'ok', items: list.routines, truncated: list.truncated };
}

/** Starts a run now, outside the schedule. */
export function runRoutine(id: string, deps: CloudDeps = CLOUD): Promise<boolean> {
  return post(deps, `${TRIGGERS}/${encodeURIComponent(id)}/run`, {});
}

/** Pauses or resumes: a partial update that carries the switch and nothing else. */
export function setRoutineEnabled(id: string, enabled: boolean, deps: CloudDeps = CLOUD): Promise<boolean> {
  return post(deps, `${TRIGGERS}/${encodeURIComponent(id)}`, { enabled });
}

async function post(deps: CloudDeps, url: string, body: unknown): Promise<boolean> {
  const s = await signedIn(deps);
  if (s === undefined) return false;
  const res = await deps.send({ method: 'POST', url, headers: headers(s), body });
  return res !== undefined && res.status >= 200 && res.status < 300;
}
