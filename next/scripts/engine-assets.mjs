// Gathers in engine/ what V1's engine needs beside its code once Koh-Vibe 2
// runs it (src/host/engine.ts): the hook bridges, the koh-vibe skill, the two
// sounds, and the hooks installer — bundled into one file, read from V1's
// TypeScript sources rather than its compiled out/. Built, never committed.
import { build } from 'esbuild';
import { chmodSync, cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const next = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(next, '..');
const engine = join(next, 'engine');

export async function buildEngineAssets() {
  rmSync(engine, { recursive: true, force: true });
  mkdirSync(join(engine, 'bin'), { recursive: true });
  for (const name of readdirSync(join(repo, 'bin'))) {
    cpSync(join(repo, 'bin', name), join(engine, 'bin', name));
    chmodSync(join(engine, 'bin', name), 0o755);
  }
  cpSync(join(repo, 'skill'), join(engine, 'skill'), { recursive: true });
  mkdirSync(join(engine, 'resources', 'sounds'), { recursive: true });
  for (const name of ['Attente.wav', 'Fin.wav', 'CREDITS.md']) {
    cpSync(join(repo, 'resources', 'sounds', name), join(engine, 'resources', 'sounds', name));
  }
  await build({
    entryPoints: [join(repo, 'scripts', 'install-hooks.cjs')],
    outfile: join(engine, 'scripts', 'install-hooks.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'warning',
    plugins: [
      {
        // The installer requires V1's compiled modules (../out/x.js): take their sources.
        name: 'v1-sources',
        setup(b) {
          b.onResolve({ filter: /^\.\.\/out\// }, (args) => ({ path: join(repo, 'src', args.path.replace(/^\.\.\/out\//, '').replace(/\.js$/, '.ts')) }));
        },
      },
    ],
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildEngineAssets();
