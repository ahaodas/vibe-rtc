import * as React from "react";
import {useEffect, useState} from "react";
import { useParams, Link } from "react-router-dom";
import { useVibeRTC } from "@vibe-rtc/rtc-react";

export default function CallerRoomPage() {
    const { roomId } = useParams<{ roomId: string }>();
    const [messages, setMessages] = useState<string[]>([])
    const {
        status,
        lastError,
        attachAsCaller,
        sendFast,
        sendReliable,
        endRoom,
        lastFastMessage,
        lastReliableMessage
    } = useVibeRTC();

    useEffect(() => {
        if (!roomId) return;
        let cancelled = false;
        (async () => {
            try {
                await attachAsCaller(roomId);
            } catch (e) {
                console.error(e);
            }
            if (!cancelled) {
                // noop
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [roomId, attachAsCaller]);


    useEffect(() => {
        setMessages(x =>  ([`Fast: ${ JSON.stringify(lastFastMessage)}`, ...x]))
    }, [lastFastMessage]);
    useEffect(() => {
        setMessages(x =>  ([`Reliable: ${JSON.stringify(lastReliableMessage)}`, ...x]))
    }, [lastReliableMessage]);


    const calleeLink = roomId ? `/callee/${roomId}` : "";

    return (
        <div style={{ padding: 16 }}>
            <h2>Caller / Room: {roomId}</h2>

            <div style={{ marginBottom: 8 }}>
                Status: <b>{status}</b>
            </div>
            {lastError && (
                <div style={{ color: "crimson", marginBottom: 8 }}>
                    {lastError.message}
                </div>
            )}
            {status === 'connected' && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button onClick={() => sendFast("caller-fast")}>Send fast</button>
                <button onClick={() => sendReliable("caller-rel")}>Send reliable</button>
                <button onClick={() => endRoom()}>End room</button>
            </div>
            )}

            <div style={{ marginTop: 12 }}>
                Share this link with callee:&nbsp;
                {roomId ? (
                    <Link target={'_blank'} to={`/callee/${roomId}`}>{calleeLink}</Link>
                ) : (
                    <em>no room</em>
                )}
            </div>
            <ul>{messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
    );
}
