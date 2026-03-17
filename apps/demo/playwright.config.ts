import { defineConfig, devices } from '@playwright/test'

const USING_FIREBASE_EMULATOR =
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST) ||
    Boolean(process.env.VITE_FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.VITE_FIREBASE_AUTH_EMULATOR_HOST)

export default defineConfig({
    testDir: './e2e',
    timeout: USING_FIREBASE_EMULATOR ? 90_000 : 120_000,
    expect: { timeout: USING_FIREBASE_EMULATOR ? 15_000 : 20_000 },
    retries: 0,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        trace: 'retain-on-failure',
    },
    reporter: [['line'], ['html', { open: 'never' }]],
    webServer: {
        command: 'pnpm exec vite --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
