// Bundles the extension host side into out/extension.js.
import { build } from 'esbuild';
import { buildEngineAssets } from './engine-assets.mjs';
import { hostOptions } from './host-options.mjs';

await build(hostOptions);
await buildEngineAssets();
