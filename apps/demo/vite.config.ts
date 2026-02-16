import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
    base: process.env.VITE_BASE_PATH ?? '/',
    appType: 'spa',
    plugins: [react()],
    server: { host: true, port: 5173 },
    build: { sourcemap: true },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
        dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    },
})
