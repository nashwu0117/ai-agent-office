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
    proxy: {
      "/api": `http://localhost:${serverPort}`,
    },
  },
});
