import { describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Status } from '../src/events/types';
import { STATUS_ICON_DIR, STILL_ICON_DIR, statusIconPath } from '../src/ui/status-icon';

const ALL: readonly Status[] = ['running', 'waiting', 'done_unseen', 'idle'];
const ROOT = join(__dirname, '..');

describe('statusIconPath', () => {
  it('gives a light/dark pair to every status, with no exception', () => {
    for (const status of ALL) {
      const paths = statusIconPath('/ext', status);
      expect(paths.light, `statut ${status}`).toMatch(/\.svg$/);
      expect(paths.dark, `statut ${status}`).toMatch(/\.svg$/);
      expect(paths.light, `statut ${status}`).not.toBe(paths.dark);
    }
  });

  it('never gives the same file to two different statuses', () => {
    const seen = ALL.flatMap((s) => Object.values(statusIconPath('/ext', s)));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('sits under the package root it is given', () => {
    expect(statusIconPath('/ext', 'running').dark.startsWith(join('/ext', 'resources', STATUS_ICON_DIR))).toBe(true);
  });

  // The test that really matters: a table naming a missing file produces a
  // row WITHOUT an icon, and the badge is the only place where the status
  // can be read. A status added without going back through
  // scripts/make-status-icons.cjs must show up here, not in the user's
  // sidebar.
  it('names files that actually exist in the package', async () => {
    for (const status of ALL) {
      const paths = statusIconPath(ROOT, status);
      for (const file of [paths.light, paths.dark]) {
        await expect(access(file), `${status} → ${file}`).resolves.toBeUndefined();
      }
    }
  });
});

const TONES = [...ALL, 'ended'] as const;

describe('statusIconPath — the still set, when animations are turned off', () => {
  it('points to the still subfolder, and only that one', () => {
    const still = statusIconPath('/ext', 'running', false);
    expect(still.dark.startsWith(join('/ext', 'resources', STATUS_ICON_DIR, STILL_ICON_DIR))).toBe(true);
    expect(statusIconPath('/ext', 'running', true).dark).not.toContain(STILL_ICON_DIR);
  });

  it('animates by default: a caller that says nothing keeps the motion', () => {
    expect(statusIconPath('/ext', 'running').dark).toBe(statusIconPath('/ext', 'running', true).dark);
  });

  // The same invariant as above, for the second set: an unchecked box must
  // not produce rows WITHOUT a badge.
  it('names files that really exist, for every tone', async () => {
    for (const tone of TONES) {
      const paths = statusIconPath(ROOT, tone, false);
      for (const file of [paths.light, paths.dark]) {
        await expect(access(file), `${tone} → ${file}`).resolves.toBeUndefined();
      }
    }
  });

  it('carries no animation, where the animated set carries one', async () => {
    // The real guarantee behind the checkbox: unchecked, nothing moves anymore.
    for (const tone of TONES) {
      const still = await readFile(statusIconPath(ROOT, tone, false).dark, 'utf8');
      expect(still, `${tone} figé`).not.toContain('animation:');
    }
    // And the motion does exist somewhere, otherwise the test above would
    // pass on its own the day the animation vanished by accident.
    const moving = await Promise.all(
      TONES.map((t) => readFile(statusIconPath(ROOT, t, true).dark, 'utf8')),
    );
    expect(moving.some((svg) => svg.includes('animation:'))).toBe(true);
  });

  it('draws the SAME thing, motion aside — otherwise cutting the animation would change the meaning', async () => {
    // The two files must speak of the same shapes: same radii, same colors,
    // same dashing. Only the <style> block and the starting angle — carried
    // by an attribute on one side and by the keyframes on the other — vary.
    for (const tone of TONES) {
      const strip = (svg: string): string =>
        svg.replace(/<style>[\s\S]*?<\/style>/, '')
          .replace(/ class="r"/, '')
          .replace(/ transform="rotate\(-90 8 8\)"/, '');
      const [moving, still] = await Promise.all([
        readFile(statusIconPath(ROOT, tone, true).dark, 'utf8').then(strip),
        readFile(statusIconPath(ROOT, tone, false).dark, 'utf8').then(strip),
      ]);
      expect(still, `${tone}`).toBe(moving);
    }
  });
});
