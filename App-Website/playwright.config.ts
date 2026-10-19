import { defineConfig } from '@playwright/test';
const origin = `http://127.0.0.1:${process.env.GREENBIZ_DEV_PORT ?? 5173}`;
export default defineConfig({
  timeout: 60000,
  workers: 1,
  testDir: './tests',
  use: { baseURL: origin, viewport: { width: 390, height: 844 } },
  webServer: { command: 'npm run dev', url: origin, reuseExistingServer: true },
  reporter: 'list',
});
