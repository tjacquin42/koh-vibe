import { isRecord } from '../lib/json';
/**
 * What Claude Code passes to the statusline, and that the bridge deposits as is.
 *
 * The observed shape:
 *   {"rate_limits":{"five_hour":{"used_percentage":78,"resets_at":1786297800},
 *                   "seven_day":{"used_percentage":32,"resets_at":1786712400}}}
 *
 * `resets_at` is in SECONDS since the epoch, not milliseconds: that is
 * Unix's convention, not JavaScript's, and confusing the two would place the
 * reset in 1970.
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

/**
 * A percentage must be a finite number between 0 and 100. Outside these
 * bounds, the window is ignored rather than shown: better to show nothing
 * than a gauge at -3% or 4000%, which would cast doubt on everything else.
 */
/**
 * The deadline arrives in two forms depending on the source: a Unix
 * seconds integer (statusline) or an ISO 8601 date (API). Both are brought
 * back to SECONDS, never milliseconds — that is the unit `UsageWindow`
 * carries, and confusing the two would place the reset in 1970.
 */
function resetsAtOf(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v !== 'string' || v.length === 0) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : undefined;
}

function windowOf(v: unknown): UsageWindow | undefined {
  if (!isRecord(v)) return undefined;
  // `used_percentage` (statusline) and `utilization` (API) name the same
  // thing under two names. One reader for both, rather than two readers
  // that would drift apart.
  const raw = v['used_percentage'] ?? v['utilization'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100) return undefined;
  // A missing deadline does not invalidate the percentage: we show what we have.
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
 * `undefined` when the snapshot carries no usable window at all — the view
 * then shows nothing at all, rather than an empty row that would suggest
 * zero consumption.
 */
export function parseUsage(raw: unknown): Usage | undefined {
  if (!isRecord(raw)) return undefined;
  // Two sources, two nestings: the statusline wraps its windows in
  // `rate_limits`, Vibe Island's cache carries them at the root. The fields
  // themselves are identical, so a single reader suffices — as long as we
  // look at the right level.
  const nested = raw['rate_limits'];
  const limits = isRecord(nested) ? nested : raw;
  const fiveHour = windowOf(limits['five_hour']);
  const sevenDay = windowOf(limits['seven_day']);
  // The model windows only ever sit at the root: the statusline has none.
  const models = modelsOf(raw);
  if (fiveHour === undefined && sevenDay === undefined && models.length === 0) return undefined;
  return { fiveHour, sevenDay, models };
}
