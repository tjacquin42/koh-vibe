import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseUsage } from '../src/usage/model';
import { forgetAttempts, readUsage, refreshFromApi, REFRESH_AFTER_MS } from '../src/usage/reader';
import { accessTokenOf } from '../src/usage/oauth';

const REAL = {
  rate_limits: {
    five_hour: { used_percentage: 78, resets_at: 1786297800 },
    seven_day: { used_percentage: 32, resets_at: 1786712400 },
  },
};

describe('parseUsage', () => {
  it('reads the shape actually observed in the status line', () => {
    expect(parseUsage(REAL)).toEqual({
      fiveHour: { percent: 78, resetsAt: 1786297800 },
      sevenDay: { percent: 32, resetsAt: 1786712400 },
      models: [],
    });
  });

  it('accepts a window with no deadline — the percentage stands on its own', () => {
    expect(parseUsage({ rate_limits: { five_hour: { used_percentage: 5 } } })).toEqual({
      fiveHour: { percent: 5, resetsAt: undefined },
      sevenDay: undefined,
      models: [],
    });
  });

  it('discards an out-of-range percentage rather than showing an absurd gauge', () => {
    for (const bad of [-3, 101, Number.NaN, Number.POSITIVE_INFINITY, '78']) {
      expect(parseUsage({ rate_limits: { five_hour: { used_percentage: bad } } })).toBeUndefined();
    }
  });

  it('keeps the exact bounds', () => {
    expect(parseUsage({ rate_limits: { five_hour: { used_percentage: 0 } } })?.fiveHour?.percent).toBe(0);
    expect(parseUsage({ rate_limits: { five_hour: { used_percentage: 100 } } })?.fiveHour?.percent).toBe(100);
  });

  it('discards a null or negative deadline without losing the percentage', () => {
    const u = parseUsage({ rate_limits: { five_hour: { used_percentage: 10, resets_at: 0 } } });
    expect(u?.fiveHour).toEqual({ percent: 10, resetsAt: undefined });
  });

  it('returns undefined when nothing is usable — not a measurement of zero', () => {
    expect(parseUsage({})).toBeUndefined();
    expect(parseUsage({ rate_limits: {} })).toBeUndefined();
    expect(parseUsage({ rate_limits: 'nope' })).toBeUndefined();
    expect(parseUsage(null)).toBeUndefined();
    expect(parseUsage('{}')).toBeUndefined();
  });
});

// La forme réellement rendue par le point d'usage d'Anthropic, telle qu'on la
// trouve mise en cache sur le disque : `utilization` plutôt que
// `used_percentage`, et une date ISO plutôt que des secondes Unix.
const API = {
  five_hour: { utilization: 13, resets_at: '2026-08-14T20:10:00.000725+00:00', limit_dollars: null },
  seven_day: { utilization: 3, resets_at: '2026-08-21T13:00:00.000747+00:00' },
  seven_day_opus: null,
};

describe('parseUsage — the two vocabularies', () => {
  it('reads `utilization` as `used_percentage`, and an ISO date as seconds', () => {
    expect(parseUsage(API)).toEqual({
      fiveHour: { percent: 13, resetsAt: Math.floor(Date.parse('2026-08-14T20:10:00.000725+00:00') / 1000) },
      sevenDay: { percent: 3, resetsAt: Math.floor(Date.parse('2026-08-21T13:00:00.000747+00:00') / 1000) },
      models: [],
    });
  });

  it('brings the deadline back to SECONDS, never milliseconds', () => {
    // Une date ISO lue en millisecondes ferait un `resetsAt` mille fois trop
    // grand, et l infobulle annoncerait une réinitialisation dans 500 000 heures.
    const u = parseUsage(API)!;
    expect(u.fiveHour!.resetsAt).toBeLessThan(2_000_000_000);
  });

  it('ignores an unreadable ISO date without losing the percentage', () => {
    expect(parseUsage({ five_hour: { utilization: 7, resets_at: 'pas une date' } })?.fiveHour).toEqual({
      percent: 7,
      resetsAt: undefined,
    });
  });
});

// The per-model windows, as the API renders them today: a `limits` list whose
// `weekly_scoped` entries carry the model in `scope.model.display_name`. The
// older `seven_day_<model>` fields are still emitted (null here) and are read
// the same way when they carry something.
const SCOPED = {
  five_hour: { utilization: 43, resets_at: '2026-08-27T14:49:59.822275+00:00' },
  seven_day: { utilization: 15, resets_at: '2026-08-28T12:59:59.822297+00:00' },
  seven_day_opus: null,
  seven_day_sonnet: null,
  limits: [
    { kind: 'session', group: 'session', percent: 43, resets_at: '2026-08-27T14:49:59.822275+00:00', scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 15, resets_at: '2026-08-28T12:59:59.822297+00:00', scope: null },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 13,
      resets_at: '2026-08-28T12:59:59.822539+00:00',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
    },
  ],
};

describe('parseUsage — the windows scoped to one model', () => {
  it('reads a weekly window scoped to a model out of `limits`, named after the model', () => {
    expect(parseUsage(SCOPED)?.models).toEqual([
      { name: 'Fable', percent: 13, resetsAt: Math.floor(Date.parse('2026-08-28T12:59:59.822539+00:00') / 1000) },
    ]);
  });

  it('ignores the unscoped limits, and a scoped one that names no model or no usable percentage', () => {
    const limits = [
      { kind: 'weekly_scoped', percent: 9, scope: { model: { display_name: '' } } },
      { kind: 'weekly_scoped', percent: 9, scope: { surface: 'code' } },
      { kind: 'weekly_scoped', percent: 140, scope: { model: { display_name: 'Opus' } } },
      { kind: 'weekly_all', percent: 9, scope: { model: { display_name: 'Opus' } } },
    ];
    expect(parseUsage({ ...SCOPED, limits })?.models).toEqual([]);
  });

  it('still reads the older `seven_day_<model>` fields, and lets `limits` win on the same name', () => {
    const legacy = {
      seven_day_opus: { utilization: 40, resets_at: 1786712400 },
      seven_day_sonnet: { utilization: 2 },
    };
    expect(parseUsage({ ...SCOPED, limits: [], ...legacy })?.models).toEqual([
      { name: 'Opus', percent: 40, resetsAt: 1786712400 },
      { name: 'Sonnet', percent: 2, resetsAt: undefined },
    ]);
    const both = { ...SCOPED, seven_day_opus: { utilization: 40 }, limits: [
      { kind: 'weekly_scoped', percent: 41, scope: { model: { display_name: 'Opus' } } },
    ] };
    expect(parseUsage(both)?.models).toEqual([{ name: 'Opus', percent: 41, resetsAt: undefined }]);
  });

  it('is a reading in its own right: a model window alone is worth showing', () => {
    const only = { limits: [{ kind: 'weekly_scoped', percent: 7, scope: { model: { display_name: 'Fable' } } }] };
    expect(parseUsage(only)).toEqual({
      fiveHour: undefined,
      sevenDay: undefined,
      models: [{ name: 'Fable', percent: 7, resetsAt: undefined }],
    });
  });

  it('keeps the statusline shape, which carries no model window', () => {
    expect(parseUsage(REAL)?.models).toEqual([]);
  });
});

describe('readUsage', () => {
  const home = async (): Promise<string> => mkdtemp(join(tmpdir(), 'koh-usage-'));

  it('reads the reading cached by the API call', async () => {
    const h = await home();
    await writeFile(join(h, 'usage.json'), JSON.stringify(API), 'utf8');
    const r = await readUsage(h);
    expect(r?.usage.fiveHour?.percent).toBe(13);
    expect(r?.source).toBe('api');
  });

  it('reads what the status line bridge caught too', async () => {
    const h = await home();
    await writeFile(join(h, 'status.json'), JSON.stringify(REAL), 'utf8');
    const r = await readUsage(h);
    expect(r?.usage.fiveHour?.percent).toBe(78);
    expect(r?.source).toBe('statusline');
  });

  it('keeps the FRESHER of the two, never a fixed priority', async () => {
    const h = await home();
    await writeFile(join(h, 'usage.json'), JSON.stringify(API), 'utf8');
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(join(h, 'status.json'), JSON.stringify(REAL), 'utf8');
    expect((await readUsage(h))?.source).toBe('statusline');

    await new Promise((r) => setTimeout(r, 20));
    await writeFile(join(h, 'usage.json'), JSON.stringify(API), 'utf8');
    expect((await readUsage(h))?.source).toBe('api');
  });

  it('treats absence and unreadability as "no measurement", never as an error', async () => {
    const h = await home();
    expect(await readUsage(h)).toBeUndefined();
    await writeFile(join(h, 'status.json'), 'pas du JSON', 'utf8');
    expect(await readUsage(h)).toBeUndefined();
  });
});

describe('accessTokenOf', () => {
  it('extracts the token out of the keychain JSON', () => {
    expect(accessTokenOf(JSON.stringify({ claudeAiOauth: { accessToken: 'abc' } }))).toBe('abc');
  });

  it('returns undefined on anything that is not the expected shape', () => {
    expect(accessTokenOf('pas du JSON')).toBeUndefined();
    expect(accessTokenOf('{}')).toBeUndefined();
    expect(accessTokenOf(JSON.stringify({ claudeAiOauth: {} }))).toBeUndefined();
    expect(accessTokenOf(JSON.stringify({ claudeAiOauth: { accessToken: '' } }))).toBeUndefined();
    expect(accessTokenOf(JSON.stringify({ claudeAiOauth: { accessToken: 42 } }))).toBeUndefined();
    expect(accessTokenOf('[]')).toBeUndefined();
  });
});


describe('refreshFromApi — the pacing', () => {
  const deps = (opts: { token?: string; payload?: unknown; now?: () => number } = {}) => {
    const calls = { token: 0, fetch: 0 };
    return {
      calls,
      deps: {
        readToken: async () => {
          calls.token += 1;
          return opts.token;
        },
        fetch: async () => {
          calls.fetch += 1;
          return opts.payload;
        },
        now: opts.now ?? (() => Date.now()),
      },
    };
  };

  beforeEach(() => forgetAttempts());

  it('queries the API and caches the reading', async () => {
    const h = await mkdtemp(join(tmpdir(), 'koh-usage-'));
    const { deps: d, calls } = deps({ token: 'jeton', payload: API });
    const r = await refreshFromApi(h, false, d);
    expect(calls.fetch).toBe(1);
    expect(r?.usage.fiveHour?.percent).toBe(13);
    // Et le relevé est relisible par une autre fenêtre.
    expect((await readUsage(h))?.source).toBe('api');
  });

  it('does not call the API again until the delay has passed', async () => {
    const h = await mkdtemp(join(tmpdir(), 'koh-usage-'));
    const { deps: d, calls } = deps({ token: 'jeton', payload: API });
    await refreshFromApi(h, false, d);
    await refreshFromApi(h, false, d);
    await refreshFromApi(h, false, d);
    expect(calls.fetch).toBe(1);
  });

  it('does not loop when the keychain access fails', async () => {
    // Le défaut que ce test garde : un échec n écrit aucun fichier, donc rien
    // qui date. En comptant les succès, le rendu — qui tourne toutes les deux
    // secondes — relancerait `security` et une requête HTTPS à chaque tour.
    const h = await mkdtemp(join(tmpdir(), 'koh-usage-'));
    const { deps: d, calls } = deps({ token: undefined });
    for (let i = 0; i < 5; i++) await refreshFromApi(h, false, d);
    expect(calls.token).toBe(1);
    expect(calls.fetch).toBe(0);
  });

  it('does not loop when the API answers nonsense', async () => {
    const h = await mkdtemp(join(tmpdir(), 'koh-usage-'));
    const { deps: d, calls } = deps({ token: 'jeton', payload: { erreur: 'nope' } });
    for (let i = 0; i < 5; i++) await refreshFromApi(h, false, d);
    expect(calls.fetch).toBe(1);
  });

  it('calls the API again once the delay has passed', async () => {
    const h = await mkdtemp(join(tmpdir(), 'koh-usage-'));
    // Horloge ancrée sur l heure réelle : le second garde compare `now` à la
    // date d écriture du fichier, qui vient du système de fichiers. Une horloge
    // fictive partant de 1970 rendrait ce cache éternellement « frais ».
    let clock = Date.now();
    const { deps: d, calls } = deps({ token: 'jeton', payload: API, now: () => clock });
    await refreshFromApi(h, false, d);
    clock += REFRESH_AFTER_MS + 1_000;
    await refreshFromApi(h, false, d);
    expect(calls.fetch).toBe(2);
  });

  it('forces a refresh on demand, without waiting for the deadline', async () => {
    const h = await mkdtemp(join(tmpdir(), 'koh-usage-'));
    const { deps: d, calls } = deps({ token: 'jeton', payload: API });
    await refreshFromApi(h, false, d);
    await refreshFromApi(h, true, d);
    expect(calls.fetch).toBe(2);
  });

  it('keeps the previous measurement when the new attempt fails', async () => {
    const h = await mkdtemp(join(tmpdir(), 'koh-usage-'));
    let clock = Date.now();
    await refreshFromApi(h, false, deps({ token: 'jeton', payload: API, now: () => clock }).deps);
    clock += REFRESH_AFTER_MS + 1_000;
    const r = await refreshFromApi(h, false, deps({ token: undefined, now: () => clock }).deps);
    expect(r?.usage.fiveHour?.percent).toBe(13);
  });
});
