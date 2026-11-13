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
  return s.branch !== undefined ? `${s.project} · ${s.branch}` : s.project || t('session.untitled');
}

/** The second line: what it is doing now, else where it lives. */
export function sessionDetail(s: SessionView): string {
  if (s.pendingPermission !== undefined) return `${s.pendingPermission.tool} · ${s.pendingPermission.summary}`;
  if (s.status === 'running' && s.currentAction !== undefined) {
    const target = s.currentAction.target;
    return target !== undefined ? `${s.currentAction.tool} ${target}` : s.currentAction.tool;
  }
  return s.branch !== undefined ? `${s.project} · ${s.branch}` : s.project;
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
