import * as fs from 'node:fs'
import * as path from 'node:path'
import * as dotenv from 'dotenv'
import type { FirebaseOptions } from 'firebase/app'

export type LoadNodeEnvOptions = {
    envPath?: string
    prefix?: string
    requireAll?: boolean
}

export function cfgFromProcessEnv(prefix = 'VITE_'): FirebaseOptions {
    const get = (k: string) => process.env[prefix + k] || process.env[k]
    const cfg: FirebaseOptions = {
        apiKey: get('FIREBASE_API_KEY')!,
        projectId: get('FIREBASE_PROJECT_ID')!,
        appId: get('FIREBASE_APP_ID')!,
        authDomain: `${get('FIREBASE_PROJECT_ID')}.firebaseapp.com`,
        storageBucket: `${get('FIREBASE_APP_ID')}.appspot.com`,
        messagingSenderId: get('FIREBASE_MESSAGING_SENDER_ID'),
    }
    return cfg
}

export function loadFirebaseConfig(opts: LoadNodeEnvOptions = {}): FirebaseOptions {
    const envPath = opts.envPath ?? path.resolve(process.cwd(), '.env')
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
    const cfg = cfgFromProcessEnv(opts.prefix ?? 'VITE_')
    if (opts.requireAll) {
        for (const k of ['apiKey', 'projectId', 'appId']) {
            if (!(cfg as any)[k]) throw new Error(`[vibe-rtc] Missing ${k} in ${envPath}`)
        }
    }
    return cfg
}
