import vinext from "vinext";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";
import { connectorPreview } from "./build/connector-preview-plugin.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

export default defineConfig(async ({ command }) => {
  if (process.env.CHANYANG_DESKTOP === "1") {
    return {
      plugins: [{
        name: "chanyang-desktop-settings",
        enforce: "pre" as const,
        async transform(_code: string, id: string) {
          if (id.replaceAll("\\", "/").split("?")[0].endsWith("/lib/local-project-host.ts")) {
            const code = await readFile(new URL("./desktop/project-host.ts", import.meta.url), "utf8");
            const settingsPath = fileURLToPath(new URL("./desktop/settings-host.ts", import.meta.url));
            return { code: code.replace("from './settings-host.ts'", `from ${JSON.stringify(settingsPath)}`), map: null };
          }
          if (id.replaceAll("\\", "/").split("?")[0].endsWith("/lib/local-settings-host.ts")) {
            return { code: await readFile(new URL("./desktop/settings-host.ts", import.meta.url), "utf8"), map: null };
          }
        },
        resolveId(id: string) {
          if (id === "@/lib/local-project-host" || id.replaceAll("\\", "/").endsWith("/lib/local-project-host.ts")) {
            return fileURLToPath(new URL("./desktop/project-host.ts", import.meta.url));
          }
          if (id === "@/lib/local-settings-host" || id.replaceAll("\\", "/").endsWith("/lib/local-settings-host.ts")) {
            return fileURLToPath(new URL("./desktop/settings-host.ts", import.meta.url));
          }
        },
      }, vinext()],
      envDir: false as const,
      server: { host: "127.0.0.1" },
      resolve: { alias: [
        { find: /^cloudflare:workers$/, replacement: fileURLToPath(new URL("./desktop/cloudflare-env.ts", import.meta.url)) },
        { find: /^@\/lib\/local-project-host$/, replacement: fileURLToPath(new URL("./desktop/project-host.ts", import.meta.url)) },
        { find: /^@\/lib\/local-settings-host$/, replacement: fileURLToPath(new URL("./desktop/settings-host.ts", import.meta.url)) },
      ] },
    };
  }
  let hostingConfig: { d1?: string; r2?: string } = {};
  try { hostingConfig = JSON.parse(await readFile(new URL("./.openai/hosting.json", import.meta.url), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const { d1, r2 } = hostingConfig;
  const localBindingConfig = {
    main: "./build/sites-worker.ts",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: d1 ? [{ binding: d1, database_name: "site-creator-d1", database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID }] : [],
    r2_buckets: r2 ? [{ binding: r2, bucket_name: "site-creator-r2" }] : [],
  };
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...localBindingConfig,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./build/connector-preview-worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
