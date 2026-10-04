import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Static SPA only: no SSR, no hosted inference backend. The dev server binds loopback.
// In development /brain is proxied to the loopback Brain operator surface; production
// cross-device builds use the Drive transport instead and never reach a PC port.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": here("./src"), "@contracts": here("../contracts") },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [here("."), here("../contracts"), here("../config"), here("../docs/project")] },
    proxy: {
      "/brain": { target: `http://127.0.0.1:${process.env.LL_BRAIN_PORT ?? "8765"}`, changeOrigin: false, rewrite: (p) => p.replace(/^\/brain/, "") },
    },
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: { target: "es2022", sourcemap: true, outDir: "dist" },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    css: false,
    restoreMocks: true,
  },
});
