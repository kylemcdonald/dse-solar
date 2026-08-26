import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { loadReceiptArchive, privateModeEnabled, receiptAllowlist } from "./app/api/receipts/receiptServer";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // The app runs in a Workers-compatible dev runtime, so host environment
  // variables must be forwarded explicitly as Worker bindings. Keep private
  // mode opt-in: the trusted local service supplies this flag, public builds
  // and deployments do not.
  vars: process.env.DSE_PRIVATE_MODE
    ? { DSE_PRIVATE_MODE: process.env.DSE_PRIVATE_MODE }
    : {},
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

function privateReceiptsDevPlugin(): Plugin {
  return {
    name: "dse-private-receipts-dev",
    apply: "serve",
    configureServer(server) {
      if (!privateModeEnabled()) return;
      server.middlewares.use((request, response, next) => {
        if (request.method !== "GET") return next();
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname === "/api/receipts/status") {
          response.statusCode = 200;
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ privateMode: true }));
          return;
        }
        if (pathname !== "/api/receipts/download") return next();
        try {
          const archive = loadReceiptArchive();
          response.statusCode = 200;
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Disposition", 'attachment; filename="dse-fiji-receipts.zip"');
          response.setHeader("Content-Length", String(archive.length));
          response.setHeader("Content-Type", "application/zip");
          response.setHeader("X-Content-Type-Options", "nosniff");
          response.setHeader("X-Receipt-Count", String(receiptAllowlist().size));
          response.end(archive);
        } catch {
          response.statusCode = 409;
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("Receipt archive is incomplete");
        }
      });
    },
  };
}

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      allowedHosts: ["vibecheck.local", "vibecheck.taildd340.ts.net"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      privateReceiptsDevPlugin(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
