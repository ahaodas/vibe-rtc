import { ensureFirebase, FBAdapter } from '@vibe-rtc/rtc-firebase'
import {
    FIREBASE_AUTH_EMULATOR_HOST,
    FIRESTORE_EMULATOR_HOST,
} from '@/features/demo/model/constants'
export function createDemoSignalServer() {
    return async () => {
        const firebaseConfig = {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
        }

        const { db, auth } = await ensureFirebase(firebaseConfig, {
            firestoreEmulatorHost: FIRESTORE_EMULATOR_HOST,
            authEmulatorHost: FIREBASE_AUTH_EMULATOR_HOST,
        })

        return new FBAdapter(db, auth, {
            securityMode: 'demo_hardened',
            importTokensFromHash: true,
            callbacks: {
                onSecurityError(error) {
                    const message = error instanceof Error ? error.message : String(error)
                    console.error(
                        `[vibe-demo][security] error\n${JSON.stringify({ message }, null, 4)}`,
                    )
                },
            },
        })
    }
}
