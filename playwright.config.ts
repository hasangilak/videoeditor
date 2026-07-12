import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:3000',
    // system Chrome: real codecs + MediaRecorder, no browser download step
    channel: 'chrome',
    viewport: { width: 1600, height: 1000 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
