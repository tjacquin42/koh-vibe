import type { ArtifactView, ClosedView, SessionView, Snapshot } from '../../src/shared/protocol';
import { fold } from './format';

export interface SearchResults {
  sessions: SessionView[];
  closed: ClosedView[];
  artifacts: ArtifactView[];
}

/**
 * Every word of the query has to appear somewhere in the item — title,
 * project, branch — in any order, case and accents ignored. « koh plan »
 * finds « Plan Koh-Vibe V2 ».
 */
function matches(words: readonly string[], ...fields: (string | undefined)[]): boolean {
  const hay = fold(fields.filter((f): f is string => f !== undefined).join(' '));
  return words.every((w) => hay.includes(w));
}

export function queryWords(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** `undefined` for an empty query: the tabs show, not a result list. */
export function search(snap: Snapshot, query: string): SearchResults | undefined {
  const words = queryWords(query);
  if (words.length === 0) return undefined;
  return {
    sessions: snap.sessions.filter((s) => matches(words, s.title, s.project, s.branch)),
    // A closed conversation that is back on the list shows once, as itself.
    closed: snap.closed.filter(
      (c) => !snap.sessions.some((s) => s.id === c.sessionId) && matches(words, c.title, c.project),
    ),
    artifacts: (snap.artifacts?.items ?? []).filter((a) => matches(words, a.title, a.project)),
  };
}

export function isEmpty(r: SearchResults): boolean {
  return r.sessions.length === 0 && r.closed.length === 0 && r.artifacts.length === 0;
}
