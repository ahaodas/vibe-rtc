/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_FIREBASE_API_KEY: string
    readonly VITE_FIREBASE_AUTH_DOMAIN: string
    readonly VITE_FIREBASE_PROJECT_ID: string
    readonly VITE_FIREBASE_APP_ID: string
    readonly VITE_METERED_CREDENTIAL: string
    readonly VITE_METERED_USER: string
    // при необходимости добавь storageBucket, messagingSenderId и т.д.
}
interface ImportMeta {
    readonly env: ImportMetaEnv
}
