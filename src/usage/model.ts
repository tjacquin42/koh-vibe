/**
 * Ce que Claude Code passe à la statusline, et que le pont dépose tel quel.
 *
 * La forme observée :
 *   {"rate_limits":{"five_hour":{"used_percentage":78,"resets_at":1786297800},
 *                   "seven_day":{"used_percentage":32,"resets_at":1786712400}}}
 *
 * `resets_at` est en SECONDES depuis l'époque, pas en millisecondes : c'est la
 * convention d'Unix, pas celle de JavaScript, et les confondre placerait la
 * réinitialisation en 1970.
 */
export interface UsageWindow {
  percent: number;
  resetsAt: number | undefined;
}

/** A weekly window that counts one model only, named after that model. */
export interface ScopedWindow extends UsageWindow {
  name: string;
}

export interface Usage {
  fiveHour: UsageWindow | undefined;
  sevenDay: UsageWindow | undefined;
  /**
   * The per-model weekly windows, in the order the source lists them. Empty
   * for the statusline, which carries none, and for an account with no
   * scoped limit.
   */
  models: readonly ScopedWindow[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Un pourcentage doit être un nombre fini entre 0 et 100. Hors de ces bornes,
 * la fenêtre est ignorée plutôt qu'affichée : mieux vaut ne rien montrer qu'une
 * jauge à -3 % ou à 4000 %, qui ferait douter de tout le reste.
 */
/**
 * L'échéance arrive sous deux formes selon la source : un entier de secondes
 * Unix (statusline) ou une date ISO 8601 (API). Les deux sont ramenées à des
 * SECONDES, jamais à des millisecondes — c'est l'unité que porte `UsageWindow`,
 * et les confondre placerait la réinitialisation en 1970.
 */
function resetsAtOf(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v !== 'string' || v.length === 0) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : undefined;
}

function windowOf(v: unknown): UsageWindow | undefined {
  if (!isRecord(v)) return undefined;
  // `used_percentage` (statusline) et `utilization` (API) désignent la même
  // chose sous deux noms. Un seul lecteur pour les deux, plutôt que deux
  // lecteurs qui divergeraient.
  const raw = v['used_percentage'] ?? v['utilization'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100) return undefined;
  // Une échéance absente n'invalide pas le pourcentage : on affiche ce qu'on a.
  return { percent: raw, resetsAt: resetsAtOf(v['resets_at']) };
}

/**
 * The older per-model fields, still emitted by the API (as `null` on an
 * account without them). Read BEFORE `limits`, so that the newer list wins
 * whenever both name the same model.
 */
const LEGACY_MODEL_FIELDS = [
  ['seven_day_opus', 'Opus'],
  ['seven_day_sonnet', 'Sonnet'],
] as const;

/**
 * The windows scoped to one model. Two vocabularies again: the `limits` list
 * carries them as `weekly_scoped` entries whose `scope.model.display_name` is
 * the model, with `percent` where a window says `utilization` — hence the
 * record rebuilt for `windowOf`, so that the percentage and deadline obey the
 * one rule everything else obeys. An entry that names no model, or whose
 * percentage is unusable, is dropped rather than shown as a nameless row.
 */
function modelsOf(raw: Record<string, unknown>): ScopedWindow[] {
  const byName = new Map<string, ScopedWindow>();
  for (const [field, name] of LEGACY_MODEL_FIELDS) {
    const w = windowOf(raw[field]);
    if (w !== undefined) byName.set(name, { name, ...w });
  }
  const limits = raw['limits'];
  if (Array.isArray(limits)) {
    for (const limit of limits) {
      if (!isRecord(limit) || limit['kind'] !== 'weekly_scoped') continue;
      const scope = limit['scope'];
      const model = isRecord(scope) ? scope['model'] : undefined;
      const name = isRecord(model) ? model['display_name'] : undefined;
      if (typeof name !== 'string' || name.length === 0) continue;
      const w = windowOf({ utilization: limit['percent'], resets_at: limit['resets_at'] });
      if (w !== undefined) byName.set(name, { name, ...w });
    }
  }
  return [...byName.values()];
}

/**
 * `undefined` quand l'instantané ne porte aucune fenêtre exploitable — la vue
 * n'affiche alors rien du tout, plutôt qu'une ligne vide qui laisserait croire
 * à une consommation nulle.
 */
export function parseUsage(raw: unknown): Usage | undefined {
  if (!isRecord(raw)) return undefined;
  // Deux sources, deux emboîtements : la statusline enveloppe ses fenêtres dans
  // `rate_limits`, le cache de Vibe Island les porte à la racine. Les champs
  // eux-mêmes sont identiques, donc une seule lecture suffit — dès lors qu'on
  // regarde au bon niveau.
  const nested = raw['rate_limits'];
  const limits = isRecord(nested) ? nested : raw;
  const fiveHour = windowOf(limits['five_hour']);
  const sevenDay = windowOf(limits['seven_day']);
  // The model windows only ever sit at the root: the statusline has none.
  const models = modelsOf(raw);
  if (fiveHour === undefined && sevenDay === undefined && models.length === 0) return undefined;
  return { fiveHour, sevenDay, models };
}
