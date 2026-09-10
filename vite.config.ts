import { readFileSync } from "node:fs";
import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

/**
 * The local worker's plain-text `vars`, read from the ignored `.env` file so
 * secrets never enter this committed config. Wrangler's own `.env` loading
 * reaches the worker only as secret bindings, while the application reads
 * `process.env` — populated from vars by the flag below — the way the Sites
 * runtime populates it in production. Without this bridge a local dev server
 * answers `error=config` at the Owner PIN login whatever `.env` contains.
 */
function readLocalEnvVars(): Record<string, string> {
  try {
    const vars: Record<string, string> = {};
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (match) vars[match[1]] = match[2];
    }
    return vars;
  } catch {
    return {};
  }
}

// The Sites runtime populates process.env from the platform environment in
// production (ownerPin/canonicalOrigin checks read process.env there). The
// local workerd runtime only does that with the `nodejs_compat_populate_process_env`
// flag plus plain-text vars, so without both a local dev server answers
// `error=config` at the Owner PIN login no matter what `.env` says, and local
// behavior drifts from production for every process.env reader. Both are added
// for `vite dev` only: a production build must neither bake `.env` values into
// its emitted wrangler config nor change the platform's compatibility flags.
function localDevOnlyExtensions(isDev: boolean) {
  if (!isDev) return {};
  return {
    compatibility_flags: ["nodejs_compat", "nodejs_compat_populate_process_env"],
    vars: readLocalEnvVars(),
  };
}

function localBindingConfig(isDev: boolean) {
  return {
    main: "./worker/index.ts",
    ...localDevOnlyExtensions(isDev),
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
}

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig(command === "serve"),
      }),
    ],
  };
});
