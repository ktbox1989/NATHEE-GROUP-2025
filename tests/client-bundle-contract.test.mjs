import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The client bundle once shipped with vinext's router broken in a way every
// gate missed: the Link/Form shims dynamically imported `navigateClientSide`
// from a chunk that did not export it, so every in-app click answered
// `TypeError: e is not a function` and the Owner saw a back office where
// nothing could be pressed. HTML-only tests cannot see this class of failure —
// the pages rendered perfectly — so this contract inspects the built bundle
// itself and must run after `npm run build`.

const chunkDirectory = fileURLToPath(
  new URL("../dist/client/_next/static/chunks/", import.meta.url),
);

function chunkSources() {
  try {
    return readdirSync(chunkDirectory)
      .filter((name) => name.endsWith(".js"))
      .map((name) => ({ name, source: readFileSync(chunkDirectory + name, "utf8") }));
  } catch {
    return [];
  }
}

test("the client bundle carries the router runtime its links import", () => {
  const chunks = chunkSources();
  assert.ok(chunks.length > 0, "no client chunks were found — run npm run build first");

  // The importer side: vinext's link shim references the symbol.
  const importers = chunks.filter(({ source }) => source.includes("navigateClientSide"));
  assert.ok(
    importers.some(({ name }) => name.startsWith("link-") || name.startsWith("vinext-")),
    "no chunk references navigateClientSide — the router shim did not ship",
  );

  // The provider side: at least one chunk that is not merely the importer must
  // carry the implementation, otherwise every import of it resolves to
  // undefined and each click dies with "is not a function".
  const providers = chunks.filter(
    ({ name, source }) =>
      !(name.startsWith("link-")) &&
      source.includes("navigateClientSide"),
  );
  assert.ok(
    providers.length > 0,
    "navigateClientSide is referenced but no chunk provides it — client navigation will throw on every click",
  );
});

test("the app browser entry exists so hydration has a starting point", () => {
  const manifest = readFileSync(
    fileURLToPath(new URL("../dist/client/vinext-client-entry-manifest.json", import.meta.url)),
    "utf8",
  );
  const { appBrowserEntry } = JSON.parse(manifest);
  assert.ok(typeof appBrowserEntry === "string" && appBrowserEntry.endsWith(".js"), "appBrowserEntry must name a chunk");
  const entry = readFileSync(
    fileURLToPath(new URL("../dist/client/" + appBrowserEntry, import.meta.url)),
    "utf8",
  );
  assert.ok(entry.length > 0, "the app browser entry chunk is empty");
});
