import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width:1100, height:760 }, screenshot:'only-on-failure' },
  projects: [
    { name:'windows-chromium', use:{ browserName:'chromium' } },
    { name:'macos-webkit', use:{ browserName:'webkit' } },
  ],
  webServer: { command:'node tests/server.js', url:'http://127.0.0.1:4173', reuseExistingServer:!process.env.CI },
});
