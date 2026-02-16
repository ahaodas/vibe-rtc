import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: { entry: 'src/index.ts' },
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    outExtension({ format }) {
        return format === 'esm' ? { js: '.mjs' } : { js: '.cjs' }
    },
})
