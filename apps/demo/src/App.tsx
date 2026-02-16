import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useVibeRTC } from "@vibe-rtc/rtc-react";

type Role = "caller" | "callee" | "auto";

type LogLine = {
    at: string;
    lane: "fast" | "reliable" | "event";
    text: string;
};

export function App() {
    const rtc = useVibeRTC();
    const [role, setRole] = useState<Role>("caller");
    const [roomInput, setRoomInput] = useState("");
    const [fastText, setFastText] = useState("ping-fast");
    const [reliableText, setReliableText] = useState("ping-reliable");
    const [logs, setLogs] = useState<LogLine[]>([]);

    useEffect(() => {
        if (rtc.roomId) setRoomInput(rtc.roomId);
    }, [rtc.roomId]);

    useEffect(() => {
        if (!rtc.lastFastMessage) return;
        setLogs((prev) => [
            {
                at: new Date(rtc.lastFastMessage!.at).toLocaleTimeString(),
                lane: "fast",
                text: rtc.lastFastMessage!.data,
            },
            ...prev,
        ]);
    }, [rtc.messageSeqFast, rtc.lastFastMessage]);

    useEffect(() => {
        if (!rtc.lastReliableMessage) return;
        setLogs((prev) => [
            {
                at: new Date(rtc.lastReliableMessage!.at).toLocaleTimeString(),
                lane: "reliable",
                text: rtc.lastReliableMessage!.data,
            },
            ...prev,
        ]);
    }, [rtc.messageSeqReliable, rtc.lastReliableMessage]);

    useEffect(() => {
        setLogs((prev) => [
            {
                at: new Date().toLocaleTimeString(),
                lane: "event",
                text: `status: ${rtc.status}`,
            },
            ...prev,
        ]);
    }, [rtc.status]);

    const calleeUrl = useMemo(() => {
        if (!rtc.roomId) return "";
        return `${window.location.origin}?room=${rtc.roomId}&role=callee`;
    }, [rtc.roomId]);

    const callerUrl = useMemo(() => {
        if (!rtc.roomId) return "";
        return `${window.location.origin}?room=${rtc.roomId}&role=caller`;
    }, [rtc.roomId]);

    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        const room = p.get("room");
        const roleParam = p.get("role");
        if (room) setRoomInput(room);
        if (roleParam === "caller" || roleParam === "callee") {
            setRole(roleParam);
        }
    }, []);

    const createRoom = async () => {
        const id = await rtc.createChannel();
        setRole("caller");
        setRoomInput(id);
    };

    const attach = async () => {
        if (!roomInput.trim()) return;
        if (role === "caller") await rtc.attachAsCaller(roomInput.trim());
        else if (role === "callee") await rtc.attachAsCallee(roomInput.trim());
        else await rtc.attachAuto(roomInput.trim(), { allowTakeOver: true, staleMs: 60_000 });
    };

    const join = async () => {
        if (!roomInput.trim()) return;
        await rtc.joinChannel(roomInput.trim());
    };

    return (
        <main className="lab">
            <header className="hero">
                <h1>Vibe RTC Manual Lab</h1>
                <p>Ручное тестирование reconnect/reload и обмена сообщениями поверх rtc-core.</p>
            </header>

            <section className="panel">
                <div className="row">
                    <label className="label">Role</label>
                    <select
                        className="input"
                        value={role}
                        onChange={(e) => setRole(e.target.value as Role)}
                    >
                        <option value="caller">caller</option>
                        <option value="callee">callee</option>
                        <option value="auto">auto</option>
                    </select>
                </div>

                <div className="row">
                    <label className="label">Room ID</label>
                    <input
                        className="input"
                        placeholder="room id"
                        value={roomInput}
                        onChange={(e) => setRoomInput(e.target.value)}
                    />
                </div>

                <div className="actions">
                    <button onClick={() => void createRoom()}>Create Room (caller)</button>
                    <button onClick={() => void join()}>Join as callee</button>
                    <button onClick={() => void attach()}>Attach as selected role</button>
                    <button onClick={() => void rtc.disconnect()}>Disconnect</button>
                    <button onClick={() => void rtc.endRoom()}>End Room</button>
                </div>

                <div className="actions">
                    <button onClick={() => void rtc.reconnectSoft()}>Reconnect Soft</button>
                    <button onClick={() => void rtc.reconnectHard({ awaitReadyMs: 12_000 })}>
                        Reconnect Hard
                    </button>
                </div>
            </section>

            <section className="grid">
                <article className="panel">
                    <h2>Transport</h2>
                    <p>
                        status: <b>{rtc.status}</b>
                    </p>
                    {rtc.lastError && (
                        <p className="error">
                            {rtc.lastError.code ? `${rtc.lastError.code}: ` : ""}
                            {rtc.lastError.message}
                        </p>
                    )}

                    <div className="row">
                        <label className="label">Fast</label>
                        <input
                            className="input"
                            value={fastText}
                            onChange={(e) => setFastText(e.target.value)}
                        />
                        <button onClick={() => void rtc.sendFast(fastText)}>Send</button>
                    </div>

                    <div className="row">
                        <label className="label">Reliable</label>
                        <input
                            className="input"
                            value={reliableText}
                            onChange={(e) => setReliableText(e.target.value)}
                        />
                        <button onClick={() => void rtc.sendReliable(reliableText)}>Send</button>
                    </div>
                </article>

                <article className="panel">
                    <h2>Multi-Tab Links</h2>
                    <div className="linkbox">{callerUrl || "Create room to get caller link"}</div>
                    <div className="linkbox">{calleeUrl || "Create room to get callee link"}</div>
                </article>
            </section>

            <section className="grid">
                <article className="panel">
                    <h2>Message/Event Log</h2>
                    <ul className="log">
                        {logs.map((l, i) => (
                            <li key={`${l.at}-${i}`}>
                                <span className={`lane lane-${l.lane}`}>{l.lane}</span>
                                <span className="time">{l.at}</span>
                                <span>{l.text}</span>
                            </li>
                        ))}
                    </ul>
                </article>

                <article className="panel">
                    <h2>Debug State</h2>
                    <pre className="debug">{JSON.stringify(rtc.debugState ?? {}, null, 2)}</pre>
                </article>
            </section>
        </main>
    );
}

