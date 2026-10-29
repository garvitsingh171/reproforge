import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'tests/**/*.test.ts',
      'apps/companion/tests/**/*.test.ts',
    ],
    testTimeout: 15000,
  },
});
