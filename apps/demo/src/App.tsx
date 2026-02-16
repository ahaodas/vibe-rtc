import * as React from "react";
import { Routes, Route, Link, useNavigate } from "react-router-dom";
import { useVibeRTC } from "@vibe-rtc/rtc-react";
import CallerRoomPage from "./routes/CallerRoomPage";
import CalleeRoomPage from "./routes/CalleeRoomPage";

export function App() {
    const { createChannel, debugState } = useVibeRTC();
    const nav = useNavigate();

    const handleCreateAsCaller = async () => {
        const id = await createChannel(); // создаём комнату (caller)
        nav(`/caller/${id}`);
    };

    return (
        <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
            <h1>Vibe RTC Demo</h1>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button onClick={handleCreateAsCaller}>Create room (caller)</button>
            </div>
                <table style={{borderCollapse: "collapse"}}>{
                    Object.entries(debugState || {})
                        .map(([key, value], i)  =>
                            (<tr style={{borderBottom: '1px solid'}} key={i}><td style={{padding: 2, borderRight: '1px solid'}}>{key}</td><td style={{padding: 2}}>{JSON.stringify(value)}</td></tr>)
                        )}
                </table>

            <Routes>
                <Route path="/caller/:roomId" element={<CallerRoomPage />} />
                <Route path="/callee/:roomId" element={<CalleeRoomPage />} />
                {/* можно оставить корневую страницу */}
                <Route
                    path="/"
                    element={
                        <div style={{ opacity: 0.8 }}>
                            <p>
                                Create a room as <b>caller</b> and share the callee link with a
                                friend:
                            </p>
                            <ol>
                                <li>Click “Create room (caller)”.</li>
                                <li>
                                    You’ll be redirected to <code>/caller/:roomId</code>.
                                </li>
                                <li>
                                    Share <code>/callee/:roomId</code> with the other side.
                                </li>
                            </ol>
                        </div>
                    }
                />
            </Routes>
        </div>
    );
}
