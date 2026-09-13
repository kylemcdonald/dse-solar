import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const pagesRoot = fileURLToPath(new URL("./static-site", import.meta.url));

export default defineConfig({
  base: "./",
  server: { host: "0.0.0.0", allowedHosts: ["vibecheck.local", "vibecheck.taildd340.ts.net"] },
  preview: { host: "0.0.0.0", allowedHosts: ["vibecheck.local", "vibecheck.taildd340.ts.net"] },
  root: pagesRoot,
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-pages", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});
