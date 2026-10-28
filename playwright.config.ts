import { defineConfig, devices } from '@playwright/test';

// Set E2E_PORT to run beside another checkout's server on the default port.
const PORT = Number(process.env.E2E_PORT ?? 4173);

// CI runners have no GPU, so the globe renders in software and every step is several times
// slower than on a laptop; give tests there proportionally more time.
const SLOW = process.env.CI ? 2 : 1;

// The tests run against the static export in out/, the same files that ship. Build first with
// `npm run build`. See docs/architecture.md#testing.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 30_000 * SLOW,
  expect: { timeout: 5_000 * SLOW },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
      testMatch: /(mobile|share)\.spec\.ts/,
    },
  ],
  webServer: {
    command: `npx serve out --listen ${PORT} --no-clipboard`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
