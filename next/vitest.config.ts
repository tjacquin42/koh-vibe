import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // `pnpm test:coverage`: the V2's own code, host and view — not the V1 modules it reads through.
    coverage: { provider: 'v8', include: ['src/**', 'view/src/**'], reporter: ['text-summary', 'html'] },
  },
  resolve: {
    // `vscode` only exists inside the extension host. The V1 modules the host
    // reads through (groups/model) import it too, so the alias covers them.
    alias: { vscode: fileURLToPath(new URL('./test/stubs/vscode.ts', import.meta.url)) },
  },
});
