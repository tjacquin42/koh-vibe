import { CLOUD, type CloudDeps, type Credentials } from '../cloud/account';
import type { Fetched } from '../cloud/feed';
import { API_ORIGIN, type Method } from '../cloud/request';
import { ARTIFACTS_PAGE, isFramesListing, parseArtifacts, type Artifact } from './model';

/**
 * The artifact endpoints, called as Claude Code's own Artifact tool calls them
 * — read in its 2.1.282 bundle, documented nowhere. Same rule as the routines:
 * if they move, the view says « unavailable », and the output channel says
 * which call broke.
 */
const FRAME = `${API_ORIGIN}/api/frame`;
const BETA = 'oauth-2025-04-20';

/** The organization goes along when known: no effect if useless, one cause of failure less if not. */
function headers(c: Credentials): Record<string, string> {
  return {
    authorization: `Bearer ${c.token}`,
    'anthropic-beta': BETA,
    ...(c.organization === undefined ? {} : { 'x-organization-uuid': c.organization }),
  };
}

export async function listArtifacts(deps: CloudDeps = CLOUD): Promise<Fetched<Artifact>> {
  const c = await deps.credentials();
  if (c === undefined) return { kind: 'signed-out' };
  const res = await deps.send({
    method: 'GET',
    url: `${FRAME}/frames?limit=${ARTIFACTS_PAGE}`,
    headers: headers(c),
    expects: isFramesListing,
  });
  if (res === undefined || res.status !== 200) return { kind: 'unavailable' };
  const list = parseArtifacts(res.body);
  return list === undefined ? { kind: 'unavailable' } : { kind: 'ok', items: list.artifacts, truncated: list.truncated };
}

/** Renames an artifact: its title on claude.ai, for everyone who can see it. */
export function renameArtifact(slug: string, title: string, deps: CloudDeps = CLOUD): Promise<boolean> {
  return change(deps, 'POST', `${FRAME}/retitle/${encodeURIComponent(slug)}`, { title });
}

/**
 * Pins or unpins a page in claude.ai's sidebar. Claude Code sends this one
 * through its cloud relay only; whether the direct call is accepted was
 * checked when this shipped — see the spec.
 */
export function setArtifactPinned(slug: string, pinned: boolean, deps: CloudDeps = CLOUD): Promise<boolean> {
  return change(deps, pinned ? 'POST' : 'DELETE', `${FRAME}/favorite/${encodeURIComponent(slug)}`);
}

async function change(deps: CloudDeps, method: Method, url: string, body?: unknown): Promise<boolean> {
  const c = await deps.credentials();
  if (c === undefined) return false;
  const res = await deps.send({ method, url, headers: headers(c), ...(body === undefined ? {} : { body }) });
  return res !== undefined && res.status >= 200 && res.status < 300;
}
