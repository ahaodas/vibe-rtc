import React, { useEffect, useState } from "react";
import { useParams} from "react-router-dom";
import { VibeRTCProvider } from "@vibe-rtc/rtc-react";
import { RTCSignaler } from "@vibe-rtc/rtc-core";
import { FBAdapter, ensureFirebase } from "@vibe-rtc/rtc-firebase";
const fbConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const VibeProviderRoot = ({ children }: { children: React.ReactNode }) => {
    const { roomId } = useParams<{ roomId: string }>();
    const role = roomId ? "callee": "caller";
    const [signaler, setSignaler] = useState<RTCSignaler | null>(null);
    const [bootError, setBootError] = useState<string | null>(null);
    const [booting, setBooting] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setBooting(true);
        setBootError(null);

        (async () => {
            try {
                // 1) Инициализируем Firebase (демо использует FB как сигналинг-бэкенд)
                const { db, auth } = await ensureFirebase(fbConfig);
                const adapter = new FBAdapter(db, auth);

                // 2) Создаём сигналер с выбранной ролью
                const rtcConfiguration: RTCConfiguration = {
                    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
                };
                const s = new RTCSignaler(role, adapter, { rtcConfiguration });

                if (!cancelled) setSignaler(s);
            } catch (e: any) {
                if (!cancelled) setBootError(e?.message ?? String(e));
            } finally {
                if (!cancelled) setBooting(false);
            }
        })();

        // при смене роли/перемонтировании — аккуратно закрыть предыдущий сигналер
        return () => {
            cancelled = true;
            try {
                signaler?.hangup?.();
            } catch {}
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [role, fbConfig.apiKey, fbConfig.authDomain, fbConfig.projectId, fbConfig.appId]);

    if (booting) {
        return <div style={{ padding: 16, opacity: 0.7 }}>Booting VibeRTC…</div>;
    }
    if (bootError) {
        return (
            <div style={{ padding: 16, color: "crimson" }}>
                Failed to bootstrap VibeRTC: {bootError.toString()}
            </div>
        );
    }
    if (!signaler) return <div style={{padding: 16, color: "crimson"}}>Did not init signaler</div>;
    return (
        <VibeRTCProvider signaler={signaler} autoConnect={false}>
            {children}
        </VibeRTCProvider>
        );
}
