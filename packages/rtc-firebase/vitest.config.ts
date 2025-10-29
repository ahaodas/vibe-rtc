import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        hookTimeout: 60000,
        testTimeout: 30000,
        //setupFiles: ['tests/helpers/setup.ts'],
        include: [
            'tests/**/*.test.{ts,tsx,js,jsx,mts,cts}',
            'tests/**/*.int.test.{ts,tsx,js,jsx,mts,cts}',
        ],
    },
})
