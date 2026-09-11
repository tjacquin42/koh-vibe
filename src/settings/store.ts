import { commitMerged, readRaw, withFileQueue } from '../lib/shared-file';
import { type AppSettings, defaultSettings, parseSettings, serializeSettings } from './model';

/** Un fichier absent ou illisible vaut « réglages par défaut ». Ne lève jamais. */
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
 * Pose le fichier partagé s'il n'existe pas encore, à partir de ce que cet
 * éditeur avait dans ses propres réglages.
 *
 * Ne fait rien si le fichier est là : le premier éditeur qui démarre après la
 * migration fixe la valeur, les suivants la lisent. Sans cette garde, chaque
 * démarrage réimposerait les réglages locaux de SON éditeur, et les deux
 * continueraient de se contredire — en pire, puisqu'ils se battraient.
 */
export async function seedSettings(file: string, from: () => AppSettings): Promise<AppSettings> {
  const raw = await readRaw(file);
  return raw === undefined ? writeSettings(file, from()) : parseSettings(raw);
}
