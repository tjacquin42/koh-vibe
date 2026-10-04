import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Without `include`, the compiled `out/` tree would be counted too.
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary', 'json'],
      // Ratchet floor, not today's figure (currently 87.2%): CI fails if a
      // change drops the total below 80%, rather than locking in the exact
      // level reached while this file was first covered.
      thresholds: { lines: 80 },
    },
  },
  resolve: {
    // `vscode` only exists inside the real extension host: in tests, it
    // resolves to a minimal stub (test/stubs/vscode.ts) so the modules that
    // depend on it (FocusBroker, SessionsTree) can be loaded and tested.
    alias: { vscode: fileURLToPath(new URL('./test/stubs/vscode.ts', import.meta.url)) },
  },
});
