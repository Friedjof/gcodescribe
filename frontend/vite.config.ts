/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = process.env.PLOTTER_PORT ?? "8010";

// Build straight into the FastAPI static dir so the backend can serve the SPA.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../plotter/web/static",
    emptyOutDir: true,
  },
  test: {
    setupFiles: ["src/test/setup.ts"],
  },
  server: {
    // Polling also covers Vite's config/env files and keeps `make dev` usable
    // when other applications have exhausted the user's inotify budget.
    // CHOKIDAR_USEPOLLING=false can opt back into native watchers.
    watch: {
      usePolling: true,
      interval: 500,
    },
    proxy: {
      "/api": {
        target: `http://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
});
