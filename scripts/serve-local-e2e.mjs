#!/usr/bin/env node
// Serves the real production build (`dist/server/index.js`) in Node with local
// adapters: D1 over a sqlite file, R2 from Miniflare, static assets from
// `dist/client`, and application environment from the ignored `.env`.
//
// This exists so the authenticated admin UI can be exercised end to end on a
// developer machine against the artifact that would actually ship — the dev
// server's workerd runtime never populates `process.env` the way the Sites
// runtime does, so Owner PIN login cannot run there. Nothing here mocks the
// application: every request goes through the real worker, real database
// queries and real R2 calls.
//
// Usage:
//   npm run build
//   node scripts/serve-local-e2e.mjs            # http://localhost:8787
//
// Database: .wrangler/state D1 sqlite is copied to .local-e2e/ on first run so
// dev state is never mutated; apply migrations there if the copy is missing.

import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Miniflare } from "miniflare";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.LOCAL_E2E_PORT ?? 8787);
const ORIGIN = `http://localhost:${PORT}`;

// --- application environment (same file the dev server reads) ---------------

for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}
// The local origin is a fact about this process, not a deployment setting.
process.env.APP_ORIGIN = ORIGIN;
// Opt in to full render errors: production builds omit Server Components error
// messages, which is right for readers and useless for debugging.
if (process.env.LOCAL_E2E_DETAILED_ERRORS === "1") process.env.NODE_ENV = "development";

// --- D1 adapter over node:sqlite --------------------------------------------

class LocalD1Statement {
  #db;
  #sql;
  #params;

  constructor(db, sql, params = []) {
    this.#db = db;
    this.#sql = sql;
    this.#params = params;
  }

  bind(...params) {
    return new LocalD1Statement(this.#db, this.#sql, params);
  }

  #rows() {
    try {
      return this.#db.prepare(this.#sql).all(...this.#params);
    } catch (error) {
      console.error(`LOCAL_E2E_DB_ERROR ${this.#sql}\nparams=${JSON.stringify(this.#params)}\n${error?.stack ?? error}`);
      throw error;
    }
  }

  async all() {
    return { success: true, results: this.#rows(), meta: {} };
  }

  async raw() {
    // D1's raw() answers rows as arrays in select order; node:sqlite returns
    // objects, so re-map through the statement's declared column order.
    const statement = this.#db.prepare(this.#sql);
    const columns = statement.columns().map((column) => column.column || column.name);
    const rows = await this.all();
    return rows.results.map((row) => columns.map((name) => row[name]));
  }

  async first() {
    return this.#db.prepare(this.#sql).get(...this.#params) ?? null;
  }

  async run() {
    const info = this.#db.prepare(this.#sql).run(...this.#params);
    return { success: true, results: [], meta: { changes: info.changes, duration: 0 } };
  }

  /**
   * What D1 answers for this statement inside a batch: SELECTs carry rows,
   * everything else carries its change count — routes read `meta.changes` to
   * prove a write landed, so answering an empty meta here would make
   * successful writes look like lost-update refusals.
   */
  async asBatchResult() {
    if (/^\s*(select|with)\b/i.test(this.#sql)) return await this.all();
    return await this.run();
  }
}

function createLocalD1(databasePath) {
  const db = new DatabaseSync(databasePath);
  return {
    prepare: (sql) => new LocalD1Statement(db, sql),
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.asBatchResult());
      return results;
    },
    async exec(sql) {
      db.exec(sql);
      return { success: true };
    },
  };
}

// --- local database ----------------------------------------------------------

const localDirectory = join(root, ".local-e2e");
mkdirSync(localDirectory, { recursive: true });
const databasePath = join(localDirectory, "app.sqlite");
if (!existsSync(databasePath)) {
  const wranglerD1Directory = join(root, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
  const source = existsSync(wranglerD1Directory)
    ? readdirSync(wranglerD1Directory).find((name) => name !== "metadata.sqlite")
    : null;
  if (source) copyFileSync(join(wranglerD1Directory, source), databasePath);
  else {
    // No dev state to copy: build the schema straight from the migrations.
    const { readFileSync: read } = await import("node:fs");
    const fresh = new DatabaseSync(databasePath);
    fresh.exec("PRAGMA foreign_keys = ON");
    const migrations = readdirSync(join(root, "drizzle")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
    for (const name of migrations) {
      for (const statement of read(join(root, "drizzle", name), "utf8").split("--> statement-breakpoint")) {
        if (statement.trim()) fresh.exec(statement);
      }
    }
    fresh.close();
  }
}

// --- R2 bucket from Miniflare ------------------------------------------------

const miniflare = new Miniflare({
  modules: true,
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  r2Buckets: ["FILES"],
  r2Persist: join(localDirectory, "r2"),
  script: "export default { async fetch() { return new Response('r2 harness', { status: 404 }); } }",
});
const FILES = await miniflare.getR2Bucket("FILES");

// --- static assets from the build --------------------------------------------

const clientRoot = join(root, "dist", "client");
const CONTENT_TYPES = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

const ASSETS = {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const file = resolve(clientRoot, pathname.replace(/^\/+/, ""));
    if (!file.startsWith(clientRoot)) {
      console.error(`LOCAL_E2E_ASSETS_REJECT ${pathname} -> ${file}`);
      return new Response("Not found", { status: 404 });
    }
    try {
      const body = readFileSync(file);
      const type = CONTENT_TYPES[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream";
      return new Response(body, { headers: { "content-type": type, "cache-control": "no-store" } });
    } catch (error) {
      console.error(`LOCAL_E2E_ASSETS_MISS ${pathname} -> ${file}: ${error?.message ?? error}`);
      return new Response("Not found", { status: 404 });
    }
  },
};

// --- the real worker, and the HTTP bridge ------------------------------------

// The build imports `cloudflare:workers` for the ambient `env` object, a scheme
// Node's loader refuses. The shim exports an `env` proxy that reads the
// bindings this bridge passes to each `worker.fetch` call — exactly what the
// Workers runtime does with the `env` parameter — and every built chunk that
// imports the scheme is rewritten to import the shim instead. `dist/` is build
// output; the next `npm run build` restores it.
const workersShimPath = join(localDirectory, "cloudflare-workers-shim.mjs");
writeFileSync(
  workersShimPath,
  "export const env = new Proxy({}, { get(_target, prop) { return globalThis.__LOCAL_E2E_ENV?.[prop]; } });\n",
);
const shimSpecifier = JSON.stringify(pathToFileURL(workersShimPath).href);
const staticDirectory = join(root, "dist", "server", "_next");
function patchDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) patchDirectory(path);
    else if (entry.name.endsWith(".js")) {
      const source = readFileSync(path, "utf8");
      if (source.includes('"cloudflare:workers"')) {
        writeFileSync(path, source.replaceAll('"cloudflare:workers"', shimSpecifier));
      }
    }
  }
}
patchDirectory(staticDirectory);

// With LOCAL_E2E_DETAILED_ERRORS, also stop the production build from hiding
// Server Components render errors. The sanitizer's nodeEnv default is baked in
// as "production" at build time, so patching the guard is the only way to see
// the original message from a production artifact. Debugging aid only: the next
// `npm run build` restores the unmodified bundle.
if (process.env.LOCAL_E2E_DETAILED_ERRORS === "1") {
  for (const relative of ["index.js", "ssr/index.js"]) {
    const path = join(root, "dist", "server", relative);
    const source = readFileSync(path, "utf8");
    const guarded = source.replace(/(\w+)!==`production`\)return (\w+)/g, "true)return $2");
    if (guarded !== source) writeFileSync(path, guarded);
  }
}

const workerUrl = new URL(pathToFileURL(join(root, "dist", "server", "index.js")).href);
workerUrl.searchParams.set("t", `${process.pid}-${Date.now()}`);

// Server-side failures the frameworks swallow still surface as rejections.
process.on("unhandledRejection", (reason) => {
  console.error(`LOCAL_E2E_UNHANDLED_REJECTION\n${reason?.stack ?? reason}`);
});

// Vinext forwards the original (pre-sanitize) render error here when a handler
// is registered — the same hook an `instrumentation.ts` would use.
globalThis.__VINEXT_onRequestErrorHandler__ = (error, context) => {
  console.error(`LOCAL_E2E_REQUEST_ERROR ${context?.routerPath ?? context?.pathname ?? ""}\n${error?.stack ?? error}`);
  if (error?.cause) console.error(`LOCAL_E2E_REQUEST_ERROR_CAUSE\n${error.cause?.stack ?? error.cause}`);
};

const { default: worker } = await import(workerUrl.href);

const db = createLocalD1(databasePath);
globalThis.__LOCAL_E2E_ENV = { DB: db, FILES };

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const headers = { ...incoming.headers };
    delete headers["accept-encoding"];
    const url = new URL(incoming.url, ORIGIN);

    // Static assets are served before the worker, the way the platform's
    // assets binding routes them in production; a path with no matching file
    // falls through to the worker (dynamic routes, RSC, API).
    const file = resolve(clientRoot, url.pathname.replace(/^\/+/, ""));
    if (file.startsWith(clientRoot) && existsSync(file) && statSync(file).isFile()) {
      const type = CONTENT_TYPES[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream";
      outgoing.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      outgoing.end(readFileSync(file));
      return;
    }

    const request = new Request(url.href, {
      method: incoming.method,
      headers,
      ...(body !== undefined && incoming.method !== "GET" && incoming.method !== "HEAD" ? { body } : {}),
      redirect: "manual",
    });
    if (process.env.LOCAL_E2E_TRACE_POSTS === "1" && incoming.method === "POST" && url.pathname.startsWith("/api/")) {
      const params = new URLSearchParams(body?.toString("utf8") ?? "");
      const fields = {};
      for (const key of new Set(params.keys())) fields[key] = (params.get(key) ?? "").slice(0, 80);
      console.error(`LOCAL_E2E_POST ${url.pathname} content-type=${headers["content-type"] ?? "none"} fields=${JSON.stringify(fields)}`);
    }
    const response = await worker.fetch(request, { ASSETS, DB: db, FILES }, {
      waitUntil() {},
      passThroughOnException() {},
    });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    const bytes = Buffer.from(await response.arrayBuffer());
    outgoing.end(bytes);
  } catch (error) {
    // Vinext's production sanitize step hides the thrown error behind a digest;
    // the original rides along on a well-known symbol. Print both so a broken
    // admin page is debuggable from this bridge.
    const original = error?.[Symbol.for("vinext.originalServerError")] ?? error;
    console.error(`LOCAL_E2E_RENDER_ERROR ${incoming.method} ${incoming.url}\n${original?.stack ?? original}`);
    outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    outgoing.end(`local-e2e bridge error: ${error?.stack ?? error}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`LOCAL_E2E_READY ${ORIGIN} db=${databasePath} static=${clientRoot}`);
});
