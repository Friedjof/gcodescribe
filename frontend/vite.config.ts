import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build straight into the FastAPI static dir so the backend can serve the SPA.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../plotter/web/static",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
