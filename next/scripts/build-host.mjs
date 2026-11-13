// Bundles the extension host side into out/extension.js.
import { build } from 'esbuild';
import { hostOptions } from './host-options.mjs';

await build(hostOptions);
