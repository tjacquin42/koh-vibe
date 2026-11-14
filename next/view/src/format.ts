import type { SessionView, Snapshot } from '../../src/shared/protocol';
import type { Translate } from './i18n';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Coarse on purpose: a side panel reads at a glance, not to the second. */
export function formatAge(ms: number, t: Translate): string {
  if (ms < MIN) return t('age.now');
  if (ms < HOUR) return t('age.min', { n: Math.floor(ms / MIN) });
  if (ms < DAY) return t('age.hour', { n: Math.floor(ms / HOUR) });
  return t('age.day', { n: Math.floor(ms / DAY) });
}

/**
 * Rounded, as decided during the triage: "12k", "1.4M" — the exact figure
 * says nothing more at a glance and takes three times the room.
 */
export function formatTokens(n: number): string {
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)}M`;
}

export function sessionTitle(s: SessionView, t: Translate): string {
  const title = s.title?.trim();
  if (title !== undefined && title.length > 0) return title;
  // Nothing written yet (SessionView.fresh): plain « New » where only text fits; ui/SessionName.tsx dresses it.
  if (s.fresh === true) return 'New';
  return s.branch !== undefined ? `${s.project} · ${s.branch}` : s.project || t('session.untitled');
}

/** The second line: what it is doing now, else where it lives. */
export function sessionDetail(s: SessionView): string {
  if (s.pendingPermission !== undefined) return `${toolLabel(s.pendingPermission.tool)} · ${s.pendingPermission.summary}`;
  if (s.status === 'running' && s.currentAction !== undefined) {
    const target = s.currentAction.target;
    return target !== undefined ? `${toolLabel(s.currentAction.tool)} ${target}` : toolLabel(s.currentAction.tool);
  }
  return s.branch !== undefined ? `${s.project} · ${s.branch}` : s.project;
}

/**
 * An exact moment, as a reset deadline or a routine's next run reads best:
 * "14:30" today, "Thu 14:30" within the week, "14 Nov 14:30" beyond.
 */
export function formatWhen(at: number, now: number, language: string): string {
  const time = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(at);
  const startOfDay = (ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY);
  if (days === 0) return time;
  if (days > 0 && days < 7) return `${new Intl.DateTimeFormat(language, { weekday: 'short' }).format(at)} ${time}`;
  return `${new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(at)} ${time}`;
}

/** Resident memory in whole megabytes; under one, one. */
export function megabytes(kb: number): number {
  return Math.max(1, Math.round(kb / 1024));
}

/** Folded for search: case and accents ignored, so « depense » finds « Dépense ». */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export type Tone = 'wait' | 'run' | 'done' | 'idle' | 'ended';

export function toneOf(s: SessionView): Tone {
  if (s.endedAt !== undefined) return 'ended';
  switch (s.status) {
    case 'waiting':
      return 'wait';
    case 'running':
      return 'run';
    case 'done_unseen':
      return 'done';
    case 'idle':
      return 'idle';
  }
}

export interface Counts {
  waiting: number;
  running: number;
  done: number;
}

export function countsOf(snap: Snapshot): Counts {
  const c: Counts = { waiting: 0, running: 0, done: 0 };
  for (const s of snap.sessions) {
    if (s.endedAt !== undefined) continue;
    if (s.status === 'waiting') c.waiting++;
    else if (s.status === 'running') c.running++;
    else if (s.status === 'done_unseen') c.done++;
  }
  return c;
}

/**
 * A tool's name as a line can hold it: an MCP tool (`mcp__server__tool`)
 * reads « server › tool » — the prefix says nothing, and the whole name is
 * long enough to push the line out of its box (14/11).
 */
export function toolLabel(name: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  return m === null ? name : `${m[1]} › ${m[2]}`;
}
