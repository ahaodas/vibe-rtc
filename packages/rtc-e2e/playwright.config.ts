import { defineConfig, devices } from '@playwright/test'

const USING_FIREBASE_EMULATOR =
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST) ||
    Boolean(process.env.VITE_FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.VITE_FIREBASE_AUTH_EMULATOR_HOST)

export default defineConfig({
    testDir: './tests',
    timeout: USING_FIREBASE_EMULATOR ? 60_000 : 120_000,
    expect: { timeout: USING_FIREBASE_EMULATOR ? 10_000 : 15_000 },
    retries: 0,
    use: {
        baseURL: 'http://127.0.0.1:5175',
    },
    reporter: [['line'], ['html', { open: 'never' }]],
    webServer: {
        command: 'npm run dev:e2e',
        url: 'http://127.0.0.1:5175',
        reuseExistingServer: !process.env.CI,
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
