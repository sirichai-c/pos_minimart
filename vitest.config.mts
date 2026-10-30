import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['packages/*/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'] } },
      { test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], testTimeout: 20_000 } },
      { test: { name: 'acceptance', include: ['tests/acceptance/**/*.test.ts'], testTimeout: 30_000 } },
    ],
  },
});
