import type { ActivitySessionView, SessionView } from '../../../../src/shared/protocol';
import type { ViewCtx } from '../../context';
import { toneOf, type Tone } from '../../format';
import { SessionName } from '../../components/atoms/SessionName';

/** What the transcripts say, for the views that show it: the conversations of the chosen folder, and how to tell the listed ones. */
export interface Activity {
  sessions: ActivitySessionView[];
  listed: ReadonlyMap<string, SessionView>;
  /** Whether a conversation is in the chosen folder — every one when none is chosen. */
  filed(id: string): boolean;
}

export function activityOf(ctx: ViewCtx, folder: string | null): Activity | undefined {
  const a = ctx.snapshot.activity;
  if (a === undefined) return undefined;
  const listed = new Map(ctx.snapshot.sessions.map((s) => [s.id, s]));
  // A conversation no longer on the list belongs to no folder: shown only unfiltered.
  const filed = (id: string): boolean => folder === null || ctx.where.get(id) === folder;
  return { sessions: a.sessions.filter((s) => filed(s.id)), listed, filed };
}

/** A conversation's colour: its state while it is listed, greyed once it is not. */
export function toneFor(id: string, listed: ReadonlyMap<string, SessionView>): Tone {
  const s = listed.get(id);
  return s === undefined ? 'ended' : toneOf(s);
}

/** A conversation's name as the list shows it — or, once it left the list, what its transcript says. */
export function ActivityName({ ctx, a, listed }: { ctx: ViewCtx; a: ActivitySessionView; listed: ReadonlyMap<string, SessionView> }) {
  const s = listed.get(a.id);
  return s !== undefined ? <SessionName s={s} t={ctx.t} animate={ctx.animate} /> : <>{a.title ?? a.project}</>;
}

/** While the host reads the transcripts for the first time. */
export function Loading({ ctx }: { ctx: ViewCtx }) {
  return <p className="hint pad">{ctx.t('cockpit.loading')}</p>;
}
