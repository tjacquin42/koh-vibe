/**
 * Builds what the view shows, from koh-vibe's state on disk — READ ONLY.
 *
 * While V1 is installed it owns `~/.koh-vibe`: it drains the spool, writes
 * the sessions, refreshes the usage and cloud caches. Two writers would race
 * for the same events, so this module only ever imports V1's *read* paths
 * (`readSessions`, `readGroups`, `readClosed`, `readUsage`) and parses the
 * cloud caches itself instead of going through `Feed`, which refreshes them.
 * `test/snapshot.test.ts` checks that a build leaves the directory untouched.
 */
import { readFile } from 'node:fs/promises';
import type { Session, Status } from '../../../src/events/types';
import { readClosed } from '../../../src/closed/store';
import { readGroups } from '../../../src/groups/store';
import { groupIdOf, sessionOrderOf, type GroupsState } from '../../../src/groups/model';
import { artifactsFile, closedFile, groupsFile, routinesFile, spoolDirs } from '../../../src/paths';
import { readSessions } from '../../../src/spool/persist';
import { visibleSessions } from '../../../src/store/visible';
import { readUsage, type UsageReading } from '../../../src/usage/reader';
import { isRoutine, type Routine } from '../../../src/routines/model';
import { isArtifact, type Artifact } from '../../../src/artifacts/model';
import type { ArtifactView, FolderView, RoutineView, SessionView, Snapshot, UsageView } from '../shared/protocol';

const STATUS_ORDER: Record<Status, number> = { waiting: 0, running: 1, done_unseen: 2, idle: 3 };

/**
 * V1's dashboard order (ui/tree.ts `compareSessions`), restated here rather
 * than imported: that module drags the whole VSCode tree with it. Open
 * sessions first, by status then recency; ended ones last, latest ended first.
 */
export function compareSessions(a: SessionView, b: SessionView): number {
  const tier = (s: SessionView): number => (s.endedAt === undefined ? 0 : 1);
  return (
    tier(a) - tier(b) ||
    (b.endedAt ?? 0) - (a.endedAt ?? 0) ||
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    b.lastEventAt - a.lastEventAt
  );
}

/** A hand-picked order rules; the sessions it does not name follow, in the default order. */
export function ordered(ids: readonly string[], chosen: readonly string[], byId: ReadonlyMap<string, SessionView>): string[] {
  const present = new Set(ids);
  const head = chosen.filter((id) => present.has(id));
  const named = new Set(head);
  const tail = ids
    .filter((id) => !named.has(id))
    .map((id) => byId.get(id))
    .filter((s): s is SessionView => s !== undefined)
    .sort(compareSessions)
    .map((s) => s.id);
  return [...head, ...tail];
}

export function toSessionView(s: Session): SessionView {
  const v: SessionView = {
    id: s.id,
    project: s.project,
    status: s.status,
    origin: s.origin,
    toolCount: s.toolCount,
    lastEventAt: s.lastEventAt,
  };
  if (s.title !== undefined) v.title = s.title;
  if (s.branch !== undefined) v.branch = s.branch;
  if (s.startedAt !== undefined) v.startedAt = s.startedAt;
  if (s.endedAt !== undefined) v.endedAt = s.endedAt;
  if (s.currentAction !== undefined) v.currentAction = { ...s.currentAction };
  if (s.pendingPermission !== undefined) v.pendingPermission = { ...s.pendingPermission };
  if (s.tokens !== undefined) v.tokens = { ...s.tokens };
  return v;
}

export function foldersOf(groups: GroupsState, sessions: readonly SessionView[]): { folders: FolderView[]; unfiled: string[] } {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const members = new Map<string, string[]>();
  const loose: string[] = [];
  const known = new Set(groups.groups.map((g) => g.id));
  for (const s of sessions) {
    const g = groupIdOf(groups, s.id);
    if (g !== undefined && known.has(g)) {
      const list = members.get(g) ?? [];
      list.push(s.id);
      members.set(g, list);
    } else {
      loose.push(s.id);
    }
  }
  const folders = [...groups.groups]
    .sort((a, b) => a.order - b.order)
    .map((g): FolderView => {
      const f: FolderView = {
        id: g.id,
        name: g.name,
        sessionIds: ordered(members.get(g.id) ?? [], sessionOrderOf(groups, g.id), byId),
      };
      if (g.color !== undefined) f.color = g.color;
      return f;
    });
  return { folders, unfiled: ordered(loose, sessionOrderOf(groups, undefined), byId) };
}

export function toUsageView(r: UsageReading): UsageView {
  const v: UsageView = { at: r.at, source: r.source };
  const five = r.usage.fiveHour;
  const week = r.usage.sevenDay;
  if (five !== undefined) v.fiveHour = five.resetsAt === undefined ? { percent: five.percent } : { percent: five.percent, resetsAt: five.resetsAt };
  if (week !== undefined) v.weekly = week.resetsAt === undefined ? { percent: week.percent } : { percent: week.percent, resetsAt: week.resetsAt };
  return v;
}

/** Same reading as V1's `Feed.cached`, without the refresh that writes the file. */
export async function readCache<T>(file: string, isItem: (v: unknown) => v is T): Promise<{ at: number; items: T[] } | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const rec = parsed as Record<string, unknown>;
  const at = rec['at'];
  const items = rec['items'];
  if (rec['version'] !== 1 || typeof at !== 'number' || !Number.isFinite(at) || !Array.isArray(items)) return undefined;
  const list: unknown[] = items;
  return { at, items: list.filter(isItem) };
}

function toArtifactView(a: Artifact): ArtifactView {
  const v: ArtifactView = { slug: a.slug, title: a.title, pinned: a.pinned };
  if (a.updatedAt !== undefined) v.updatedAt = a.updatedAt;
  return v;
}

function toRoutineView(r: Routine): RoutineView {
  const v: RoutineView = { id: r.id, name: r.name, enabled: r.enabled };
  if (r.nextRunAt !== undefined) v.nextRunAt = r.nextRunAt;
  return v;
}

export async function buildSnapshot(home: string, now: number): Promise<Snapshot> {
  const [all, groups, closed, usage, artifacts, routines] = await Promise.all([
    readSessions(spoolDirs(home)),
    readGroups(groupsFile(home)),
    readClosed(closedFile(home)),
    readUsage(home),
    readCache(artifactsFile(home), isArtifact),
    readCache(routinesFile(home), isRoutine),
  ]);
  const sessions = [...visibleSessions(all).values()].map(toSessionView).sort(compareSessions);
  const { folders, unfiled } = foldersOf(groups, sessions);
  const snap: Snapshot = {
    at: now,
    sessions,
    folders,
    unfiled,
    artifacts: artifacts === undefined ? undefined : { at: artifacts.at, items: artifacts.items.map(toArtifactView) },
    routines: routines === undefined ? undefined : { at: routines.at, items: routines.items.map(toRoutineView) },
    closed: closed.closed.map((e) => {
      const c = { sessionId: e.id, project: e.project, closedAt: e.closedAt };
      return e.title === undefined ? c : { ...c, title: e.title };
    }),
  };
  if (usage !== undefined) snap.usage = toUsageView(usage);
  return snap;
}
