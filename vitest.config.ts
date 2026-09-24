import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
  resolve: {
    // `vscode` only exists inside the real extension host: in tests, it
    // resolves to a minimal stub (test/stubs/vscode.ts) so the modules that
    // depend on it (FocusBroker, SessionsTree) can be loaded and tested.
    alias: { vscode: fileURLToPath(new URL('./test/stubs/vscode.ts', import.meta.url)) },
  },
});
