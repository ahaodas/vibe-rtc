import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    appType: "spa",
    plugins: [react()],
    server: { host: true, port: 5173 },
    build: { sourcemap: true },
    resolve: {
        dedupe: ["react", "react-dom",  "react/jsx-runtime"],
    },
});
