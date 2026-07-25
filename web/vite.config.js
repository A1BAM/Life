import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // pdf.js is large and only needed on the ingest screen; keep it out of the
    // main bundle so the Today screen stays fast on mobile.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    // `wrangler dev` serves the Worker on 8787.
    proxy: { "/api": "http://localhost:8787" },
  },
});
