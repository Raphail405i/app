import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databasePath = join(mkdtempSync(join(tmpdir(), 'scopeboard-e2e-')), 'test.sqlite');
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 35_000,
  expect: { timeout: 7_000 },
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3001',
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3001/api/session',
    timeout: 15_000,
    reuseExistingServer: false,
    env: { PORT: '3001', APP_ORIGIN: 'http://127.0.0.1:3001', DATABASE_PATH: databasePath, NODE_ENV: 'test' },
  },
});
