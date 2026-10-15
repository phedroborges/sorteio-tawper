import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4317', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: { command: 'node server/index.js', url: 'http://127.0.0.1:4317/health', reuseExistingServer: false, env: { PORT: '4317', HOST: '127.0.0.1', DATABASE_PATH: ':memory:' } },
  reporter: [['list']],
  timeout: 45000
});
