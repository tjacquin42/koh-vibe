import { foldedText, isRecord, isoTimeOf, nonEmptyString } from '../lib/json';

/**
 * A routine — a Claude Code agent scheduled in the cloud — as the view needs
 * it, and nothing more. The endpoint sends far more (the prompt, the whole
 * session setup: 422 KB for thirteen routines); keeping it would only bloat
 * the cache every window reads.
 */
export interface Routine {
  id: string;
  name: string;
  enabled: boolean;
  /** The schedule of a recurring routine: a cron expression, read in UTC. Absent for a one-shot. */
  cron?: string;
  /** When a one-shot is, or was, due — epoch ms. */
  runOnceAt?: number;
  /**
   * The next fire as the server computed it, jitter included — epoch ms. The
   * server keeps one even on a paused routine, where it means nothing.
   */
  nextRunAt?: number;
  /** A one-shot that already fired: nothing left to run, and nothing to resume. */
  fired: boolean;
  /** `owner/name` of each repository the routine works in. */
  repos: string[];
}

export interface RoutineList {
  routines: Routine[];
  truncated: boolean;
}

/**
 * The list endpoint's answer, or `undefined` when it is not the shape we know.
 * A row that does not read is skipped, not the whole list: one odd routine
 * must not empty the view.
 */
export function parseRoutines(raw: unknown): RoutineList | undefined {
  if (!isRecord(raw) || !Array.isArray(raw['data'])) return undefined;
  const rows: unknown[] = raw['data'];
  const routines: Routine[] = [];
  for (const row of rows) {
    const routine = routineOf(row);
    if (routine !== undefined) routines.push(routine);
  }
  return { routines, truncated: raw['has_more'] === true };
}

function routineOf(row: unknown): Routine | undefined {
  if (!isRecord(row)) return undefined;
  const id = nonEmptyString(row['id']);
  const enabled = row['enabled'];
  if (id === undefined || typeof enabled !== 'boolean') return undefined;
  const name = foldedText(row['name']);
  return {
    id,
    // claude.ai always names a routine; the id is a fallback that still tells two apart.
    name: name.length > 0 ? name : id,
    enabled,
    cron: nonEmptyString(row['cron_expression']),
    runOnceAt: isoTimeOf(row['run_once_at']),
    nextRunAt: isoTimeOf(row['next_run_at']),
    fired: row['ended_reason'] === 'run_once_fired',
    repos: reposOf(row['job_config']),
  };
}

function reposOf(jobConfig: unknown): string[] {
  if (!isRecord(jobConfig)) return [];
  const ccr = jobConfig['ccr'];
  if (!isRecord(ccr)) return [];
  const context = ccr['session_context'];
  if (!isRecord(context) || !Array.isArray(context['sources'])) return [];
  const sources: unknown[] = context['sources'];
  const out: string[] = [];
  for (const source of sources) {
    if (!isRecord(source)) continue;
    const repository = source['git_repository'];
    const name = isRecord(repository) ? repoNameOf(repository['url']) : undefined;
    if (name !== undefined) out.push(name);
  }
  return out;
}

/** `https://host/owner/name(.git)` → `owner/name`; anything else is shown as given. */
export function repoNameOf(url: unknown): string | undefined {
  const value = nonEmptyString(url);
  if (value === undefined) return undefined;
  const match = /^https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(value);
  return match?.[1] ?? value;
}

/**
 * Whether a value read back from the cache is a routine. The cache is ours,
 * but another version of the extension may have written it: a row that does
 * not match is dropped rather than drawn wrong.
 */
export function isRoutine(v: unknown): v is Routine {
  if (!isRecord(v)) return false;
  const repos = v['repos'];
  if (!Array.isArray(repos)) return false;
  const list: unknown[] = repos;
  return (
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    typeof v['enabled'] === 'boolean' &&
    typeof v['fired'] === 'boolean' &&
    list.every((r) => typeof r === 'string') &&
    optional(v['cron'], 'string') &&
    optional(v['runOnceAt'], 'number') &&
    optional(v['nextRunAt'], 'number')
  );
}

function optional(v: unknown, type: 'string' | 'number'): boolean {
  return v === undefined || typeof v === type;
}

/** The routine's page on claude.ai — where its runs are listed. */
export function routineUrl(id: string): string {
  return `https://claude.ai/code/routines/${encodeURIComponent(id)}`;
}
