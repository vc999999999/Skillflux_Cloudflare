import { defineConfig } from 'vitest/config';

// Only our own tests. bench/cache and bench/runs hold downloaded third-party
// repositories and benchmark workspaces; their test files must never run here.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['cache/**', 'runs/**', 'tasks/**', 'node_modules/**'],
  },
});
