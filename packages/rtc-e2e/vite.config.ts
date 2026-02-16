import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
    root: './src',
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
        },
    },
})
