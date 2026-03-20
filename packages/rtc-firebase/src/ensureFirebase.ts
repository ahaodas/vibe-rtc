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
    connectAuthEmulator,
    getAuth,
    getIdToken,
    initializeAuth,
    inMemoryPersistence,
    onAuthStateChanged,
    signInAnonymously,
    type User,
} from 'firebase/auth'
import { connectFirestoreEmulator, type Firestore, getFirestore } from 'firebase/firestore'

type EmulatorHostPort = { host: string; port: number }

export type EnsureFirebaseOptions = {
    firestoreEmulatorHost?: string | null
    authEmulatorHost?: string | null
    disableAuthEmulatorWarnings?: boolean
}

const connectedFirestoreEmulators = new Set<string>()
const connectedAuthEmulators = new Set<string>()

function parseHostPort(
    raw: string | null | undefined,
    defaultPort: number,
): EmulatorHostPort | null {
    if (!raw) return null
    const [host, portRaw] = raw.split(':')
    if (!host) return null
    const parsed = Number.parseInt(portRaw ?? '', 10)
    const port = Number.isFinite(parsed) ? parsed : defaultPort
    return { host, port }
}

async function waitForUser(auth: Auth): Promise<string> {
    if (auth.currentUser) {
        await getIdToken(auth.currentUser, true) // Ensure an issued token is available.
        return auth.currentUser.uid
    }
    await signInAnonymously(auth)
    const user = await new Promise<User>((resolve, reject) => {
        const unsub = onAuthStateChanged(
            auth,
            (u) => {
                if (u) {
                    unsub()
                    void getIdToken(u, true).then(
                        () => resolve(u),
                        (error) => reject(error),
                    )
                }
            },
            reject,
        )
    })
    return user.uid
}

export async function ensureFirebase(
    config: FirebaseOptions,
    options: EnsureFirebaseOptions = {},
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

    const authEmulator = parseHostPort(options.authEmulatorHost, 9099)
    if (authEmulator) {
        const key = `${app.name}:auth:${authEmulator.host}:${authEmulator.port}`
        if (!connectedAuthEmulators.has(key)) {
            const emuUrl = `http://${authEmulator.host}:${authEmulator.port}`
            connectAuthEmulator(auth, emuUrl, {
                disableWarnings: options.disableAuthEmulatorWarnings ?? true,
            })
            connectedAuthEmulators.add(key)
        }
    }

    const uid = await waitForUser(auth)
    const db = getFirestore(app)

    const firestoreEmulator = parseHostPort(options.firestoreEmulatorHost, 8080)
    if (firestoreEmulator) {
        const key = `${app.name}:firestore:${firestoreEmulator.host}:${firestoreEmulator.port}`
        if (!connectedFirestoreEmulators.has(key)) {
            connectFirestoreEmulator(db, firestoreEmulator.host, firestoreEmulator.port)
            connectedFirestoreEmulators.add(key)
        }
    }

    return { app, db, auth, uid }
}
