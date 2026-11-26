// The esbuild options for the extension host bundle, shared by the one-shot
// build and the watch mode of `pnpm dev`.
export const hostOptions = {
  entryPoints: ['src/host/extension.ts'],
  outfile: 'out/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};
