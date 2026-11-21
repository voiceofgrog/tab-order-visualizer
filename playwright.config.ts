import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve.mjs',
    url: 'http://127.0.0.1:4173/demo/index.html',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    // Chromium is the reference engine: every test, including ones that pin demo-page details.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Other engines run the tests that compare the tool with real key presses there
    // (Tab rules differ between browsers, so demo-page stop numbers legitimately differ).
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@cross-browser/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@cross-browser/ },
  ],
});
