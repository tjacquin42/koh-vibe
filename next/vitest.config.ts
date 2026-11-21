import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The view's components are drawn to a string (view/test): no browser, so no effect runs — what they say is what is checked.
    include: ['test/**/*.test.ts', 'view/test/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['view/test/setup.ts'],
    // `pnpm test:coverage`: the V2's own code, host and view — not the V1 modules it reads through.
    coverage: {
      provider: 'v8',
      include: ['src/**', 'view/src/**'],
      reporter: ['text-summary', 'html'],
      // Ratchet floor, not today's figure (currently 85%): `pnpm test:coverage`
      // fails if a change drops the total below 80%, rather than locking in the
      // exact level reached when the view's interactions were first covered.
      thresholds: { lines: 80 },
    },
  },
  esbuild: { jsx: 'automatic' },
  resolve: {
    // `vscode` only exists inside the extension host. The V1 modules the host
    // reads through (groups/model) import it too, so the alias covers them.
    alias: { vscode: fileURLToPath(new URL('./test/stubs/vscode.ts', import.meta.url)) },
  },
});
