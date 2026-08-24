import { commitMerged, readRaw, withFileQueue } from '../lib/shared-file';
import {
  type ClosedEntry,
  type ClosedState,
  emptyClosed,
  parseClosed,
  remember,
  serializeClosed,
} from './model';

/** An absent, unreadable or malformed file is an empty list: the view renders regardless. */
export async function readClosed(file: string): Promise<ClosedState> {
  return toState(await readRaw(file));
}

/**
 * Archives one close. The queueing and the re-read-before-rename loop both
 * come from lib/shared-file.ts, shared with the folder layout
 * (groups/store.ts).
 *
 * There is no three-way merge here, unlike the folders: a folder assignment
 * can be *deleted*, so that merge needs `before` (what we read) and `after`
 * (what we computed) to tell "this key is gone because I removed it" apart
 * from "I never saw it". Here nothing ever deletes an entry — `remember` only
 * ever adds one and caps the list — so re-applying `remember` to the freshest
 * content IS the union the spec asks for. The state before our edit would only
 * matter for that deletion distinction, which this file has no way to produce
 * in the first place.
 */
export function rememberClosed(file: string, entry: ClosedEntry): Promise<ClosedState> {
  return withFileQueue(file, () =>
    commitMerged(file, 'closed', (latestRaw) => remember(toState(latestRaw), entry), serializeClosed),
  );
}

function toState(raw: string | undefined): ClosedState {
  return raw === undefined ? emptyClosed() : parseClosed(raw);
}
