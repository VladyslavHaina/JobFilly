import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In development the API runs as its own process (pnpm dev); forward to it.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
