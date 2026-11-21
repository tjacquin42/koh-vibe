// Builds Koh-Vibe 2.0's package at the repository's root: the entry that
// picks the interface (src/host/main.ts) bundled to ../out/main.js, next to
// V1's compiled out/, and the web view built to ../dist/view. V1's own files
// — bridges, skill, sounds, installer — are already at the root: no engine/.
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { hostOptions } from './host-options.mjs';

await build({ ...hostOptions, entryPoints: ['src/host/main.ts'], outfile: '../out/main.js', sourcemap: false });
await viteBuild({ configFile: 'vite.config.ts', build: { outDir: '../../dist/view', emptyOutDir: true } });
