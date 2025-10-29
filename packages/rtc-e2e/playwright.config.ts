import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: './tests',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    retries: 0,
    use: {
        baseURL: 'http://127.0.0.1:5175',
    },
    reporter: [['line'], ['html', { open: process.env.CI ? 'never' : 'always' }]],
    webServer: {
        command: 'npm run dev:e2e',
        url: 'http://127.0.0.1:5175',
        reuseExistingServer: !process.env.CI,
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
