import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: [],
        reporters: ['default'],
        coverage: {
            reporter: ['text', 'lcov'],
        },
    },
})
