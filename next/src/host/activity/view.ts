import { basename } from 'node:path';
import type { ActivityItemView, ActivitySessionView, ActivityView, TokenCount } from '../../shared/protocol';
import type { FileState } from './index';

/** Two stamps closer than this belong to one stretch of work. */
export const IDLE_GAP_MS = 3 * 60_000;
/** How long a lone stamp counts for: a turn takes time even when it writes once. */
const TAIL_MS = 60_000;
const TAIL_LINES = 6;
const FEED_LINES = 250;

export function emptyTokens(): TokenCount {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

function add(into: TokenCount, u: TokenCount): void {
  into.input += u.input;
  into.output += u.output;
  into.cacheWrite += u.cacheWrite;
  into.cacheRead += u.cacheRead;
}

/** Merges sorted stamps into stretches of activity. */
export function busyStretches(stamps: readonly number[], gap = IDLE_GAP_MS): [number, number][] {
  const sorted = [...stamps].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && t - last[1] <= gap) last[1] = Math.max(last[1], t + TAIL_MS);
    else out.push([t, t + TAIL_MS]);
  }
  return out;
}

function items(state: FileState): ActivityItemView[] {
  return state.items.map((i): ActivityItemView => {
    const base = { at: i.at, sessionId: state.sessionId, subagent: state.subagent };
    if (i.kind === 'tool') {
      return i.target === undefined ? { ...base, kind: 'tool', text: '', tool: i.tool } : { ...base, kind: 'tool', text: i.target, tool: i.tool };
    }
    return { ...base, kind: i.kind, text: i.text };
  });
}

export interface KnownSession {
  title?: string;
  project: string;
}

/**
 * Folds each conversation's transcript and its subagents' into one row.
 * `known` carries what V1's list says about a conversation — its title and
 * project win over the transcript's, so the cockpit names things as the
 * sidebar does.
 */
export function toActivityView(states: readonly FileState[], now: number, since: number, known: ReadonlyMap<string, KnownSession>): ActivityView {
  interface Acc {
    row: ActivitySessionView;
    stamps: number[];
    items: ActivityItemView[];
  }
  const bySession = new Map<string, Acc>();
  for (const st of states) {
    let acc = bySession.get(st.sessionId);
    if (acc === undefined) {
      acc = {
        row: { id: st.sessionId, project: '', tokens: emptyTokens(), subagentTokens: emptyTokens(), subagents: 0, busy: [], tail: [], lastAt: 0 },
        stamps: [],
        items: [],
      };
      bySession.set(st.sessionId, acc);
    }
    const row = acc.row;
    if (!st.subagent) {
      if (st.title !== undefined) row.title = st.title;
      if (st.cwd !== undefined) row.project = basename(st.cwd);
    }
    let any = false;
    for (const u of st.usage.values()) {
      add(st.subagent ? row.subagentTokens : row.tokens, u.usage);
      acc.stamps.push(u.at);
      any = true;
    }
    const its = items(st);
    for (const i of its) acc.stamps.push(i.at);
    acc.items.push(...its);
    if (st.subagent && (any || its.length > 0)) row.subagents++;
  }
  const sessions: ActivitySessionView[] = [];
  const feed: ActivityItemView[] = [];
  for (const { row, stamps, items: its } of bySession.values()) {
    if (stamps.length === 0) continue;
    const k = known.get(row.id);
    if (k !== undefined) {
      row.project = k.project;
      if (k.title !== undefined) row.title = k.title;
    }
    if (row.project === '') row.project = '?';
    row.busy = busyStretches(stamps);
    row.lastAt = Math.max(...stamps);
    its.sort((a, b) => a.at - b.at);
    // The wall shows the conversation's own lines: its subagents' would drown them.
    row.tail = its.filter((i) => !i.subagent).slice(-TAIL_LINES);
    feed.push(...its);
    sessions.push(row);
  }
  sessions.sort((a, b) => b.lastAt - a.lastAt);
  feed.sort((a, b) => b.at - a.at);
  return { at: now, since, sessions, feed: feed.slice(0, FEED_LINES) };
}
