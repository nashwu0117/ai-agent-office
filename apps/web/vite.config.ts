import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_SERVER_PORT = 43117;
const DEFAULT_WEB_PORT = 43118;
const serverPort = Number(process.env.AI_OFFICE_SERVER_PORT ?? process.env.VITE_SERVER_PORT ?? DEFAULT_SERVER_PORT);
const webPort = Number(process.env.AI_OFFICE_WEB_PORT ?? process.env.VITE_PORT ?? DEFAULT_WEB_PORT);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    // v0.13 Cloudflare Tunnel: your-tunnel-host.example (see
    // ~/.cloudflared/config.yml) forwards to this dev server by Host header,
    // which Vite's dev server blocks by default unless allow-listed here.
    allowedHosts: ["your-tunnel-host.example"],
    proxy: {
      "/api": `http://localhost:${serverPort}`,
      "/ws": {
        target: `ws://localhost:${serverPort}`,
        ws: true,
      },
    },
  },
});
