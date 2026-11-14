/**
 * claude.ai for the V2: the artifacts and routines lists, and the calls that
 * change them — V1's own modules, wired the way V1 wires them
 * (src/ui/cloud-views.ts).
 *
 * The lists are V1's `Feed`s on the same shared cache files: at most one
 * request every five minutes whichever window asks, and only while a view
 * shows them (`cloud-cache-5min`, kept in the triage). V1 refreshes them only
 * while ITS views are open; the V2 now does the same for its own tabs, so a
 * collapsed V1 view no longer leaves the V2 with a stale list.
 */
import { listArtifacts, renameArtifact, setArtifactPinned } from '../../../src/artifacts/api';
import { isArtifact, type Artifact } from '../../../src/artifacts/model';
import type { CloudDeps, Credentials } from '../../../src/cloud/account';
import { Feed } from '../../../src/cloud/feed';
import { API_ORIGIN } from '../../../src/cloud/request';
import { artifactsFile, routinesFile } from '../../../src/paths';
import { listRoutines, runRoutine, setRoutineEnabled } from '../../../src/routines/api';
import { isRoutine, type Routine } from '../../../src/routines/model';

/**
 * Deletes a page on claude.ai, for good. V1 never had it, hence not in its
 * api.ts: the endpoint is the one Claude Code's Artifact tool calls
 * (`DELETE /api/frame/<slug>`, read in the 2.1.3xx bundle). Claude Code sends
 * it through its relay; the direct call was checked on a throwaway page on
 * 14/11 — 204, and the page gone from the listing. Headers as V1's
 * artifacts/api.ts sends them, which keeps them private: written again here.
 */
export async function deleteArtifact(slug: string, deps: CloudDeps): Promise<boolean> {
  const c = await deps.credentials();
  if (c === undefined) return false;
  const res = await deps.send({ method: 'DELETE', url: `${API_ORIGIN}/api/frame/${encodeURIComponent(slug)}`, headers: frameHeaders(c) });
  return res !== undefined && res.status >= 200 && res.status < 300;
}

function frameHeaders(c: Credentials): Record<string, string> {
  return {
    authorization: `Bearer ${c.token}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'x-frame-cp': 'go',
    'x-frame-surface': 'code',
    ...(c.organization === undefined ? {} : { 'x-organization-uuid': c.organization }),
  };
}

/** What actions.ts needs of claude.ai — an interface, so its tests need no network. */
export interface CloudActions {
  renameArtifact(slug: string, title: string): Promise<boolean>;
  pinArtifact(slug: string, pinned: boolean): Promise<boolean>;
  deleteArtifact(slug: string): Promise<boolean>;
  runRoutine(id: string): Promise<boolean>;
  setRoutineEnabled(id: string, enabled: boolean): Promise<boolean>;
  /** The routine as the freshest list knows it — a row's copy may be stale. */
  routine(id: string): Promise<Routine | undefined>;
  refresh(what: 'artifacts' | 'routines', force: boolean): Promise<void>;
}

export function cloudActions(home: string, cloud: CloudDeps, now: () => number = () => Date.now()): CloudActions {
  const routines = new Feed<Routine>(routinesFile(home), isRoutine, { fetch: () => listRoutines(cloud), now });
  const artifacts = new Feed<Artifact>(artifactsFile(home), isArtifact, { fetch: () => listArtifacts(cloud), now });
  return {
    renameArtifact: (slug, title) => renameArtifact(slug, title, cloud),
    pinArtifact: (slug, pinned) => setArtifactPinned(slug, pinned, cloud),
    deleteArtifact: (slug) => deleteArtifact(slug, cloud),
    runRoutine: (id) => runRoutine(id, cloud),
    setRoutineEnabled: (id, enabled) => setRoutineEnabled(id, enabled, cloud),
    async routine(id) {
      const view = await routines.read();
      return view.kind === 'ready' ? view.snapshot.items.find((r) => r.id === id) : undefined;
    },
    refresh: (what, force) => (what === 'artifacts' ? artifacts : routines).refresh(force),
  };
}
