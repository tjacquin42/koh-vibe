import { commitMerged, readRaw, withFileQueue } from '../lib/shared-file';
import { type AppSettings, defaultSettings, parseSettings, serializeSettings } from './model';

/** A missing or unreadable file counts as "default settings". Never throws. */
export async function readSettings(file: string): Promise<AppSettings> {
  return toSettings(await readRaw(file));
}

function toSettings(raw: string | undefined): AppSettings {
  return raw === undefined ? defaultSettings() : parseSettings(raw);
}

/**
 * Writes one or more fields over the freshest content of the file.
 *
 * Through the same two mechanisms as the folder layout and the closed
 * history (lib/shared-file.ts): the calls of this window queue up behind one
 * another, and the write is redone from whatever another window wrote in
 * between. The merge itself is trivial — the patch is laid over what is
 * there — so no three-way rule is needed, only the discipline of never
 * writing over a state one has not read.
 *
 * A plain read-then-write used to lose fields. Two calls overlapping in one
 * window — two clicks before the first had landed — each wrote the WHOLE
 * object from the same stale reading, and the second rename undid the first
 * without a word.
 */
export function writeSettings(file: string, patch: Partial<AppSettings>): Promise<AppSettings> {
  return withFileQueue(file, () =>
    commitMerged(file, 'settings', (latestRaw) => ({ ...toSettings(latestRaw), ...patch }), serializeSettings),
  );
}

/**
 * Lays down the shared file if it does not exist yet, from what this editor
 * had in its own settings.
 *
 * Does nothing if the file is already there: the first editor to start after
 * the migration fixes the value, the following ones read it. Without this
 * guard, every startup would reimpose ITS editor's local settings, and the
 * two would keep contradicting each other — worse than before, since they
 * would now fight over it.
 */
export async function seedSettings(file: string, from: () => AppSettings): Promise<AppSettings> {
  const raw = await readRaw(file);
  return raw === undefined ? writeSettings(file, from()) : parseSettings(raw);
}
