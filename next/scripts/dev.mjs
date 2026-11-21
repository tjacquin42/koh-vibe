// Everything F5 needs, in one process: the host bundle in watch mode and the
// Vite server for the view. The two marker lines are what the "next: dev"
// task in .vscode/tasks.json waits for before it starts the development host,
// so "ready" is only printed once the first host bundle is on disk and Vite
// is listening.
import { context } from 'esbuild';
import { createServer } from 'vite';
import { buildEngineAssets } from './engine-assets.mjs';
import { hostOptions } from './host-options.mjs';

console.log('koh-vibe-next: starting');

await buildEngineAssets();
const host = await context(hostOptions);
await host.rebuild();
await host.watch();

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
server.printUrls();
console.log('koh-vibe-next: ready');

const stop = async () => {
  await host.dispose();
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
