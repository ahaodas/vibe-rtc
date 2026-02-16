import {
    type FirebaseApp,
    type FirebaseOptions,
    getApp,
    getApps,
    initializeApp,
} from 'firebase/app'
import {
    type Auth,
    browserLocalPersistence,
    getAuth,
    getIdToken,
    initializeAuth,
    inMemoryPersistence,
    onAuthStateChanged,
    signInAnonymously,
} from 'firebase/auth'
import { type Firestore, getFirestore } from 'firebase/firestore'

async function waitForUser(auth: Auth): Promise<string> {
    if (auth.currentUser) {
        await getIdToken(auth.currentUser, true) // гарантируем выпущенный токен
        return auth.currentUser.uid
    }
    await signInAnonymously(auth)
    await new Promise<void>((res, rej) => {
        const unsub = onAuthStateChanged(
            auth,
            async (u) => {
                if (u) {
                    unsub()
                    await getIdToken(u, true)
                    res()
                }
            },
            rej,
        )
    })
    return auth.currentUser!.uid
}

export async function ensureFirebase(
    config: FirebaseOptions,
): Promise<{ app: FirebaseApp; db: Firestore; auth: Auth; uid: string }> {
    const app = getApps().length ? getApp() : initializeApp(config)

    let auth: Auth
    try {
        auth = getAuth(app)
    } catch {
        auth = initializeAuth(app, {
            // Node/Vitest
            persistence:
                typeof window === 'undefined' ? inMemoryPersistence : browserLocalPersistence,
        })
    }

    const uid = await waitForUser(auth)
    const db = getFirestore(app)
    return { app, db, auth, uid }
}
