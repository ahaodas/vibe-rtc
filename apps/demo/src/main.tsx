// apps/demo/src/main.tsx
import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";

import { VibeRTCProvider } from "@vibe-rtc/rtc-react";
import { FBAdapter, ensureFirebase } from "@vibe-rtc/rtc-firebase";

const rtcConfig = {
    iceServers: [
        {
            urls: [
                'stun:stun1.l.google.com:19302',
                'stun:stun2.l.google.com:19302',
                'stun:stun3.l.google.com:19302',
                //  "stun:stun4.l.google.com:19302",
            ],
        },
        {
            urls: 'turn:a.relay.metered.ca:80?transport=udp',
            username: import.meta.env.VITE_METERED_USER,
            credential: import.meta.env.VITE_METERED_CREDENTIAL,
        },
    ],
    iceCandidatePoolSize: 10,
}


const root = createRoot(document.getElementById("root")!);

function RTCWrapper({ children }: { children: React.ReactNode }) {;

    // Вариант А: провайдер сам создаёт адаптер (booting/error внутри)
    const createSignalServer = async () => {
        const fbConfig = {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
        };
        const { db, auth } = await ensureFirebase(fbConfig);
        return new FBAdapter(db, auth);
    };

    return (
        <VibeRTCProvider
            rtcConfiguration={rtcConfig}
            renderLoading={<div>Custom boot…</div>}
            renderBootError={(e) => <div style={{color:'crimson'}}>{e.message}</div>}
            createSignalServer={createSignalServer}
        >
            {children}
        </VibeRTCProvider>
    );
}

root.render(
    <BrowserRouter>
        <RTCWrapper>
            <App />
        </RTCWrapper>
    </BrowserRouter>
);
