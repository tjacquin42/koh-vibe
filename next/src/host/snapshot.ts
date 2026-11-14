/**
 * Builds what the view shows, from koh-vibe's state on disk — READ ONLY.
 *
 * While V1 is installed it owns `~/.koh-vibe`: it drains the spool, writes
 * the sessions, refreshes the usage and cloud caches. Two writers would race
 * for the same events, so this module only ever imports V1's *read* paths
 * (`readSessions`, `readGroups`, `readClosed`, `readUsage`) and parses the
 * cloud caches itself instead of going through `Feed`, which refreshes them.
 * `test/snapshot.test.ts` checks that a build leaves the directory untouched.
 * Since step 4 the V2 does refresh the cloud caches, as V1 does — but apart,
 * from cloud.ts, and only while a tab shows them; a build itself never writes.
 */
import { isSpent } from '../../../src/routines/schedule';
import { readFile } from 'node:fs/promises';
import type { Session, Status } from '../../../src/events/types';
import { readClosed } from '../../../src/closed/store';
import type { TranscriptStats } from '../../../src/transcript/reader';
import { withTokens } from '../../../src/transcript/tokens';
import { isEditorOrigin } from '../../../src/events/origin';
import { readGroups } from '../../../src/groups/store';
import { groupIdOf, sessionOrderOf, type GroupsState } from '../../../src/groups/model';
import { artifactProjectsFile, artifactsFile, closedFile, groupsFile, routinesFile, settingsFile, spoolDirs } from '../../../src/paths';
import { readSessions } from '../../../src/spool/persist';
import { visibleSessions } from '../../../src/store/visible';
import { readUsage, type UsageReading } from '../../../src/usage/reader';
import type { UsageWindow } from '../../../src/usage/model';
import { isRoutine, type Routine } from '../../../src/routines/model';
import { groupOf } from '../../../src/routines/schedule';
import { isArtifact, sortArtifacts, type Artifact } from '../../../src/artifacts/model';
import { projectOfArtifact, type ArtifactProjects } from '../../../src/artifacts/projects';
import { readArtifactProjects } from '../../../src/artifacts/projects-store';
import { readSettings } from '../../../src/settings/store';
import type { AppSettings } from '../../../src/settings/model';
import { TEMPORARY_TTL_MS } from '../../../src/store/temporary';
import type { KnownSession } from './activity/view';
import type {
  ActivityView,
  ArtifactView,
  FolderView,
  ProcessesView,
  RoutineView,
  SessionSheetView,
  SessionView,
  SettingsView,
  Snapshot,
  UsageView,
  UsageWindowView,
} from '../shared/protocol';

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

/**
 * V1 carries a reset deadline in SECONDS since the epoch (Unix's unit, the
 * statusline's); the view counts in milliseconds like everything else in it.
 */
function windowView(w: UsageWindow): UsageWindowView {
  return w.resetsAt === undefined ? { percent: w.percent } : { percent: w.percent, resetsAt: w.resetsAt * 1000 };
}

export function toUsageView(r: UsageReading): UsageView {
  const v: UsageView = { at: r.at, source: r.source, models: r.usage.models.map((m) => ({ name: m.name, ...windowView(m) })) };
  if (r.usage.fiveHour !== undefined) v.fiveHour = windowView(r.usage.fiveHour);
  if (r.usage.sevenDay !== undefined) v.weekly = windowView(r.usage.sevenDay);
  return v;
}

export function toSettingsView(s: AppSettings): SettingsView {
  return {
    animate: s.animate,
    persistent: s.persistent,
    expireTemporary: s.expireTemporary,
    // V1 keeps the volume as afplay takes it, 0–1; the view shows a percentage.
    volume: Math.round(s.volume * 100),
  };
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

export function toArtifactViews(list: readonly Artifact[], filing: ArtifactProjects): ArtifactView[] {
  return sortArtifacts(list).map((a) => {
    const v: ArtifactView = { slug: a.slug, title: a.title, pinned: a.pinned };
    if (a.updatedAt !== undefined) v.updatedAt = a.updatedAt;
    const project = projectOfArtifact(a, filing);
    if (project !== undefined) v.project = project;
    return v;
  });
}

export function toRoutineView(r: Routine, now: number): RoutineView {
  const v: RoutineView = { id: r.id, name: r.name, enabled: r.enabled, group: groupOf(r, now), repos: [...r.repos], spent: isSpent(r, now) };
  if (r.nextRunAt !== undefined) v.nextRunAt = r.nextRunAt;
  if (r.cron !== undefined) v.cron = r.cron;
  return v;
}

/**
 * A temporary conversation — in no folder — leaves the list a day after its
 * last activity when the setting says so (V1's store/temporary.ts). The view
 * shows when, so the departure is never a surprise.
 */
export function withExpiry(sessions: readonly SessionView[], unfiled: readonly string[], settings: AppSettings): SessionView[] {
  if (!settings.expireTemporary) return [...sessions];
  const loose = new Set(unfiled);
  return sessions.map((s) => (loose.has(s.id) && s.endedAt === undefined ? { ...s, expiresAt: s.lastEventAt + TEMPORARY_TTL_MS } : s));
}

export interface SnapshotExtras {
  /** What the live conversations are running. Left out by tests: it reads the process table. */
  processes?: (cwds: readonly string[]) => Promise<ProcessesView>;
  /** What the transcripts say; `undefined` while no cockpit is open to show it. */
  activity?: (known: ReadonlyMap<string, KnownSession>) => Promise<ActivityView | undefined>;
  /** The sheet of the conversation the cockpit shows, built after the activity it reads from. */
  sheet?: () => Promise<SessionSheetView | undefined>;
  /**
   * V1's per-conversation transcript readings, kept between builds so each
   * one reads only what was appended. With it, a conversation is named as V1
   * names it (transcript/reader.ts): the title chosen, else Claude's, else
   * the last thing asked, the summary, the first thing asked. Without it,
   * only the rare title the session file carries — « DEV » everywhere for
   * conversations started in ~/DEV.
   */
  transcripts?: Map<string, TranscriptStats>;
  /** The editor's tab bar, read by the extension (it is the editor's setting, not a file here). */
  editorTabs?: Snapshot['editorTabs'];
  tidy?: Snapshot['tidy'];
  theme?: Snapshot['theme'];
  ideThemed?: boolean;
}

/**
 * The title and branch V1's transcript reader finds — and nothing else: the
 * same pass sets V1's token counters, which leave out the cache and read two
 * to six hundred times low; the session keeps whatever counters it had.
 */
export async function namesFrom(sessions: Map<string, Session>, transcripts: Map<string, TranscriptStats>): Promise<void> {
  const tokens = new Map([...sessions].map(([id, s]) => [id, s.tokens] as const));
  await withTokens(sessions, transcripts);
  for (const [id, s] of sessions) {
    const kept = tokens.get(id);
    if (kept === undefined) delete s.tokens;
    else s.tokens = kept;
  }
}

export async function buildSnapshot(home: string, now: number, extras: SnapshotExtras = {}): Promise<Snapshot> {
  const [all, groups, closed, usage, artifacts, filing, routines, settings] = await Promise.all([
    readSessions(spoolDirs(home)),
    readGroups(groupsFile(home)),
    readClosed(closedFile(home)),
    readUsage(home),
    readCache(artifactsFile(home), isArtifact),
    readArtifactProjects(artifactProjectsFile(home)),
    readCache(routinesFile(home), isRoutine),
    readSettings(settingsFile(home)),
  ]);
  // Read only: V1's own reader, which opens each transcript and writes nothing.
  if (extras.transcripts !== undefined) await namesFrom(all, extras.transcripts);
  const shown = [...visibleSessions(all).values()];
  const visible = shown.map(toSessionView).sort(compareSessions);
  const { folders, unfiled } = foldersOf(groups, visible);
  const sessions = withExpiry(visible, unfiled, settings).map((s) =>
    // A conversation that waits or works has been asked something: only an idle one can be new.
    extras.transcripts !== undefined && s.status === 'idle' && s.title === undefined && s.toolCount === 0 && s.endedAt === undefined ? { ...s, fresh: true as const } : s,
  );
  const snap: Snapshot = {
    at: now,
    sessions,
    folders,
    unfiled,
    artifacts: artifacts === undefined ? undefined : { at: artifacts.at, items: toArtifactViews(artifacts.items, filing) },
    routines: routines === undefined ? undefined : { at: routines.at, items: routines.items.map((r) => toRoutineView(r, now)) },
    closed: closed.closed.map((e) => {
      const c = { sessionId: e.id, project: e.project, closedAt: e.closedAt, resumable: isEditorOrigin(e.origin) || e.origin === 'terminal' };
      return e.title === undefined ? c : { ...c, title: e.title };
    }),
    settings: toSettingsView(settings),
  };
  if (usage !== undefined) snap.usage = toUsageView(usage);
  if (extras.editorTabs !== undefined) snap.editorTabs = extras.editorTabs;
  if (extras.tidy !== undefined) snap.tidy = extras.tidy;
  if (extras.theme !== undefined) snap.theme = extras.theme;
  if (extras.ideThemed !== undefined) snap.ideThemed = extras.ideThemed;
  if (extras.processes !== undefined) snap.processes = await extras.processes([...new Set(shown.map((s) => s.cwd))]);
  if (extras.activity !== undefined) {
    const known = new Map(sessions.map((s): [string, KnownSession] => [s.id, s.title === undefined ? { project: s.project } : { project: s.project, title: s.title }]));
    const activity = await extras.activity(known);
    if (activity !== undefined) snap.activity = activity;
  }
  if (extras.sheet !== undefined) {
    const sheet = await extras.sheet();
    if (sheet !== undefined) snap.sheet = sheet;
  }
  return snap;
}
