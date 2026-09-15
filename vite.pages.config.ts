import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const pagesRoot = fileURLToPath(new URL("./static-site", import.meta.url));

export default defineConfig({
  base: process.env.PAGES_BASE_PATH ?? "/",
  server: { host: "0.0.0.0", allowedHosts: ["vibecheck.local", "vibecheck.taildd340.ts.net"] },
  preview: { host: "0.0.0.0", allowedHosts: ["vibecheck.local", "vibecheck.taildd340.ts.net"] },
  root: pagesRoot,
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react(), {
    name: "refreshable-viewer-routes",
    closeBundle() {
      const output = fileURLToPath(new URL("./dist-pages", import.meta.url));
      const html = readFileSync(`${output}/index.html`);
      writeFileSync(`${output}/404.html`, html);
      for (const [project, tabs] of Object.entries({ fiji: ["simple", "diagram", "model", "system", "bom", "costs", "cables", "notes"], polowat: ["diagram", "model", "system", "bom", "costs", "notes"] })) {
        for (const tab of ["", ...tabs]) {
          const directory = `${output}/${project}/${tab}`;
          mkdirSync(directory, { recursive: true });
          writeFileSync(`${directory}/index.html`, html);
        }
      }
    },
  }],
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
