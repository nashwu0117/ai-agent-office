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
      // v0.19 hotfix: the bare-string shorthand makes Vite's proxy set
      // changeOrigin: true internally (see vite's proxyMiddleware), which
      // rewrites the Host header to this target ("localhost:<port>") on
      // every forwarded request — silently overwriting whatever Host the
      // real client (browser, or cloudflared forwarding a Cloudflare Tunnel
      // request) actually sent. apps/server/src/auth.ts's whole access-auth
      // gate keys off that Host header to tell local dev traffic apart from
      // remote traffic, so this was defeating it entirely: every /api call
      // proxied through Vite arrived at the server looking like localhost,
      // bypassing the password gate for real remote requests. changeOrigin
      // must stay false here so the original Host header reaches the server
      // unmodified — same as "/ws" below, which was never affected because
      // its object form never got the string-shorthand's implicit true.
      "/api": {
        target: `http://localhost:${serverPort}`,
        changeOrigin: false,
      },
      "/ws": {
        target: `ws://localhost:${serverPort}`,
        ws: true,
        changeOrigin: false,
      },
    },
  },
});
