export default {
    entry: {
        index: 'src/index.ts',
        core: 'src/core.ts',
        firebase: 'src/firebase.ts',
    },
    format: ['esm', 'cjs'],
    dts: { resolve: false },
    external: ['@vibe-rtc/rtc-core', 'react'],
    clean: true,
    sourcemap: true,
}
