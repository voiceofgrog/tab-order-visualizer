import { defineConfig, devices } from '@playwright/test';

/**
 * Read-only validation against a real page. Not part of `npm test`.
 * Run with:  $env:VALIDATE_URL = 'https://example.edu/'; npm.cmd run validate
 */
export default defineConfig({
  testDir: 'validation',
  timeout: 180_000,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
