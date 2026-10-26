// Vitest config for the content tests (`npm run test:content`).
// Without it, Vitest would load the app's vite.config.ts, whose Cloudflare plugin cannot start
// inside a test runner. Content code is plain TypeScript and JSON, so no plugins are needed.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['tests/content/**/*.test.ts'],
    environment: 'node',
  },
});
