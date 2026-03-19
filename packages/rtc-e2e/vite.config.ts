import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
    root: './src',
    envPrefix: ['VITE_', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'],
    build: {
        outDir: '../dist',
        emptyOutDir: true,
    },
    server: {
        port: 5175,
        strictPort: true,
        host: '127.0.0.1',
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@vibe-rtc/rtc-core': fileURLToPath(new URL('../rtc-core/src/index.ts', import.meta.url)),
            '@vibe-rtc/rtc-firebase': fileURLToPath(
                new URL('../rtc-firebase/src/index.ts', import.meta.url),
            ),
            '@vibe-rtc/rtc-react': fileURLToPath(
                new URL('../rtc-react/src/index.ts', import.meta.url),
            ),
        },
    },
})
