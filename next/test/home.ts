import { mkdtemp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NOW = 1_800_000_000_000;

export function session(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, cwd: `/work/${id}`, project: `proj-${id}`, origin: 'vscode', status: 'idle', toolCount: 0, lastEventAt: NOW - 60_000, ...extra };
}

/** A koh-vibe state directory, shaped like V1 writes it. */
export async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'kvn-'));
  await mkdir(join(home, 'sessions'));
  await mkdir(join(home, 'events'));
  const write = (name: string, data: unknown): Promise<void> => writeFile(join(home, name), JSON.stringify(data));
  await write('sessions/a.json', session('a', { status: 'running', lastEventAt: NOW - 10_000, title: 'Alpha' }));
  await write('sessions/b.json', session('b', { status: 'waiting', lastEventAt: NOW - 50_000 }));
  await write('sessions/c.json', session('c', { status: 'idle' }));
  await write('sessions/d.json', session('d', { hidden: true }));
  await write('sessions/e.json', session('e', { status: 'done_unseen', endedAt: NOW - 5_000 }));
  await writeFile(join(home, 'sessions/broken.json'), '{not json');
  await write('groups.json', {
    version: 1,
    groups: [
      { id: 'g2', name: 'Second', order: 1 },
      { id: 'g1', name: 'First', order: 0, color: 'blue' },
    ],
    assignments: { a: 'g1', b: 'g1', e: 'g2', ghost: 'g1' },
    sessionOrder: { g1: ['a'] },
    sessionSounds: { waiting: {}, done: {} },
    artifacts: {},
  });
  await write('usage.json', {
    five_hour: { utilization: 42, resets_at: '2027-01-15T08:00:00+00:00' },
    seven_day: { utilization: 7, resets_at: '2027-01-20T08:00:00+00:00' },
    seven_day_opus: { utilization: 61, resets_at: '2027-01-20T08:00:00+00:00' },
  });
  await write('artifacts.json', {
    version: 1,
    at: NOW - 1_000,
    items: [
      { slug: 'x', title: 'Plan', updatedAt: NOW - 2_000, pinned: true },
      { slug: 'y', title: 'Notes', updatedAt: NOW - 1_500, pinned: false },
      { nope: 1 },
    ],
  });
  await write('artifact-projects.json', { version: 1, filed: { y: 'koh' }, aliases: {} });
  await write('routines.json', {
    version: 1,
    at: NOW - 1_000,
    items: [
      { id: 'r', name: 'Daily', enabled: true, fired: false, repos: ['me/daily'], cron: '0 7 * * *', nextRunAt: NOW + 60 * 60_000 },
      { id: 'q', name: 'Paused one', enabled: false, fired: false, repos: [] },
    ],
  });
  await write('settings.json', { version: 1, waiting: 'Glass', done: 'Pop', volume: 0.3, persistent: true, expireTemporary: true, animate: false });
  await write('closed.json', { version: 1, closed: [{ id: '11111111-1111-4111-8111-111111111111', cwd: '/w', project: 'old', origin: 'vscode', closedAt: NOW - 9_000 }, { id: '22222222-2222-4222-8222-222222222222', cwd: '/w', project: 'batch', origin: 'sdk', closedAt: NOW - 8_000 }] });
  return home;
}

/** Every file under `dir` with its size, mtime and content: equal fingerprints mean nothing was written. */
export async function fingerprint(dir: string): Promise<string> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const name of (await readdir(d)).sort()) {
      const p = join(d, name);
      const s = await stat(p);
      if (s.isDirectory()) {
        out.push(`${p}/ ${s.mtimeMs}`);
        await walk(p);
      } else {
        out.push(`${p} ${s.size} ${s.mtimeMs} ${await readFile(p, 'utf8')}`);
      }
    }
  };
  await walk(dir);
  return out.join('\n');
}
