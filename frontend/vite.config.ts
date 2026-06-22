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
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
});
