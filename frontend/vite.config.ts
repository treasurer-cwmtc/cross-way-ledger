import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The API base can be overridden at build time with VITE_API_BASE.
// In dev, requests to /api are proxied to the FastAPI backend.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: env.VITE_API_TARGET || "http://127.0.0.1:8000",
          changeOrigin: true,
        },
      },
    },
  };
});
