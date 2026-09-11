import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { releaseLabel, versionLabel } from '../src/ui/version';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The whole chain from the manifest to the label the view shows, run for real.
 *
 * The failure this guards against happened, and it was silent: a version
 * carrying anything beyond `x.y.z` is refused by `stamp-build.cjs` — rightly,
 * it will not invent a number it does not trust — so `build-info.json` comes
 * out with no version at all and the view falls back to « no version ». Nothing
 * fails, nothing is logged, and the badge simply stops showing a number.
 *
 * Running the real script is the point. A test that re-stated the script's own
 * rule would agree with a copy of it, not with the script.
 */
describe('the build stamp', () => {
  it('carries a version, so the view has one to show', async () => {
    // Rewrites `build-info.json`, which is exactly what `pnpm build` does
    // before every test run anyway.
    execFileSync('node', ['scripts/stamp-build.cjs'], { cwd: ROOT, stdio: 'ignore' });
    const stamp: unknown = JSON.parse(await readFile(`${ROOT}build-info.json`, 'utf8'));

    expect(releaseLabel(stamp)).toBeDefined();
    expect(versionLabel(stamp)).not.toContain('no version');
  });

  it('names the version of the manifest, which is the source of truth', async () => {
    const manifest: unknown = JSON.parse(await readFile(`${ROOT}package.json`, 'utf8'));
    const version = (manifest as { version?: unknown }).version;
    const stamp: unknown = JSON.parse(await readFile(`${ROOT}build-info.json`, 'utf8'));

    expect(releaseLabel(stamp)).toContain(String(version));
  });
});
