import assert from "node:assert/strict";
import test from "node:test";
import {
  PREVIEW_MAX_TTL_SECONDS,
  PREVIEW_QUERY_PARAMETER,
  PREVIEW_RESPONSE_HEADERS,
  assertUsableSecret,
  canonicalUrlForPreview,
  createPreviewToken,
  isPreviewRequest,
  verifyPreviewToken,
} from "../lib/public-cms/preview.ts";
import { planInvalidation, requiresPublicDeployment } from "../lib/public-cms/revalidation.ts";
import { PUBLIC_ROUTE_PATHS } from "../lib/public-cms/contract.ts";

const SECRET = "a".repeat(48);
const OTHER_SECRET = "b".repeat(48);
const NOW = 1_800_000_000_000;

// --- preview ---------------------------------------------------------------

test("a fresh token verifies for its own page and revision", async () => {
  const token = await createPreviewToken({ path: "/services/", revisionId: "rev-7" }, SECRET, NOW);
  const verdict = await verifyPreviewToken(token, { path: "/services/", revisionId: "rev-7" }, SECRET, NOW + 1000);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.ok && verdict.claim.path, "/services/");
});

test("a token cannot be replayed against another page", async () => {
  const token = await createPreviewToken({ path: "/services/", revisionId: "rev-7" }, SECRET, NOW);
  const verdict = await verifyPreviewToken(token, { path: "/about/" }, SECRET, NOW + 1000);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.reason, "path mismatch");
});

test("a token cannot be replayed against a later draft of the same page", async () => {
  // Without revision binding, one shared link would keep exposing every future
  // draft of that page.
  const token = await createPreviewToken({ path: "/services/", revisionId: "rev-7" }, SECRET, NOW);
  const verdict = await verifyPreviewToken(token, { path: "/services/", revisionId: "rev-8" }, SECRET, NOW + 1000);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.reason, "revision mismatch");
});

test("an expired token is refused", async () => {
  const token = await createPreviewToken({ path: "/services/", revisionId: "rev-7" }, SECRET, NOW, 60);
  assert.equal((await verifyPreviewToken(token, { path: "/services/" }, SECRET, NOW + 59_000)).ok, true);
  const expired = await verifyPreviewToken(token, { path: "/services/" }, SECRET, NOW + 61_000);
  assert.equal(expired.ok, false);
  assert.equal(expired.ok === false && expired.reason, "expired");
});

test("a token signed with another secret is refused", async () => {
  const token = await createPreviewToken({ path: "/services/", revisionId: "rev-7" }, OTHER_SECRET, NOW);
  const verdict = await verifyPreviewToken(token, { path: "/services/" }, SECRET, NOW + 1000);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.reason, "bad signature");
});

test("a tampered payload is refused", async () => {
  const token = await createPreviewToken({ path: "/services/", revisionId: "rev-7" }, SECRET, NOW);
  const [payload, signature] = token.split(".");

  // Re-encode a claim granting a different page, keeping the original signature.
  const forgedClaim = btoa(JSON.stringify({ path: "/about/", revisionId: "rev-7", expiresAt: NOW + 600_000 }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const forged = `${forgedClaim}.${signature}`;
  assert.equal((await verifyPreviewToken(forged, { path: "/about/" }, SECRET, NOW + 1000)).ok, false);

  // Flipping a signature character must also fail.
  const flipped = `${payload}.${signature.slice(0, -1)}${signature.at(-1) === "A" ? "B" : "A"}`;
  assert.equal((await verifyPreviewToken(flipped, { path: "/services/" }, SECRET, NOW + 1000)).ok, false);
});

test("absent and malformed tokens are refused", async () => {
  for (const token of [null, undefined, "", ".", "no-separator", "a.", ".b", "x".repeat(5000)]) {
    const verdict = await verifyPreviewToken(token, { path: "/services/" }, SECRET, NOW);
    assert.equal(verdict.ok, false, `${String(token)} must be refused`);
  }
});

test("a weak or missing preview secret fails closed", () => {
  for (const secret of [undefined, "", "short", "a".repeat(31)]) {
    assert.throws(() => assertUsableSecret(secret), /at least 32/);
  }
  assert.equal(assertUsableSecret(SECRET), SECRET);
});

test("a token cannot be minted with an over-long life", async () => {
  await assert.rejects(
    () => createPreviewToken({ path: "/services/", revisionId: "r" }, SECRET, NOW, PREVIEW_MAX_TTL_SECONDS + 1),
    /ttl must be between/,
  );
  await assert.rejects(() => createPreviewToken({ path: "/services/", revisionId: "r" }, SECRET, NOW, 0), /ttl/);
});

test("preview responses are never indexable or cacheable", () => {
  assert.match(PREVIEW_RESPONSE_HEADERS["X-Robots-Tag"], /noindex/);
  assert.match(PREVIEW_RESPONSE_HEADERS["X-Robots-Tag"], /nofollow/);
  assert.match(PREVIEW_RESPONSE_HEADERS["Cache-Control"], /no-store/);
  assert.match(PREVIEW_RESPONSE_HEADERS["Cache-Control"], /private/);
  // A shared cache holding a draft would serve it to everyone.
  assert.doesNotMatch(PREVIEW_RESPONSE_HEADERS["Cache-Control"], /public/);
});

test("a preview request is detectable and never canonical", () => {
  const preview = new URL(`https://natheegroup2025.com/services/?${PREVIEW_QUERY_PARAMETER}=abc`);
  assert.equal(isPreviewRequest(preview), true);
  assert.equal(isPreviewRequest(new URL("https://natheegroup2025.com/services/")), false);

  // The canonical points at the published URL, so a leaked preview link cannot
  // outrank or replace the real page.
  const canonical = canonicalUrlForPreview(preview);
  assert.equal(canonical, "https://natheegroup2025.com/services/");
  assert.ok(!canonical.includes(PREVIEW_QUERY_PARAMETER));
});

// --- publish invalidation --------------------------------------------------

test("publishing a page invalidates that page and refreshes the sitemap", () => {
  const plan = planInvalidation({ kind: "PAGE_PUBLISHED", path: "/about/", revisionId: "rev-3" });
  assert.deepEqual(plan.paths, ["/about/"]);
  assert.equal(plan.regenerateSitemap, true);
  assert.deepEqual(plan.removedPaths, []);
});

test("unpublishing removes the URL and takes it out of the sitemap", () => {
  const plan = planInvalidation({ kind: "PAGE_UNPUBLISHED", path: "/dealer-fleet/" });
  assert.ok(plan.paths.includes("/dealer-fleet/"));
  assert.ok(plan.paths.includes("/sitemap.xml"));
  assert.deepEqual(plan.removedPaths, ["/dealer-fleet/"]);
  assert.equal(plan.regenerateSitemap, true);
});

test("the home page cannot be unpublished", () => {
  const plan = planInvalidation({ kind: "PAGE_UNPUBLISHED", path: "/" });
  assert.deepEqual(plan.paths, []);
  assert.deepEqual(plan.removedPaths, []);
  assert.match(plan.reason, /cannot be unpublished/);
});

test("media changes invalidate the pages that show them plus gallery and home", () => {
  const plan = planInvalidation({
    kind: "MEDIA_WITHDRAWN",
    mediaId: "motorcycle-truck-loading-01",
    usedOnPaths: ["/services/"],
  });
  // The home page carries a gallery preview, so a withdrawn photograph must
  // leave it too, not only the page that named it.
  assert.ok(plan.paths.includes("/services/"));
  assert.ok(plan.paths.includes("/gallery/"));
  assert.ok(plan.paths.includes("/"));
  assert.equal(plan.regenerateSitemap, false);
});

test("a media event cannot invalidate a route the site does not serve", () => {
  const plan = planInvalidation({
    kind: "MEDIA_PUBLISHED",
    mediaId: "x",
    usedOnPaths: ["/admin/", "/app/"] as never,
  });
  assert.deepEqual(plan.paths, ["/", "/gallery/"]);
});

test("publishing settings invalidates every public route", () => {
  const plan = planInvalidation({ kind: "SETTINGS_PUBLISHED", revisionId: "rev-9" });
  for (const path of PUBLIC_ROUTE_PATHS) {
    assert.ok(plan.paths.includes(path), `${path} must be invalidated`);
  }
  assert.ok(plan.paths.includes("/robots.txt"));
});

test("ordinary content and media edits never require a public deployment", () => {
  // This is the promise the CMS makes to editors: no SSH, no Git, no deploy.
  const routineEdits = [
    { kind: "PAGE_PUBLISHED", path: "/about/", revisionId: "r" },
    { kind: "PAGE_UNPUBLISHED", path: "/storage/" },
    { kind: "MEDIA_PUBLISHED", mediaId: "m", usedOnPaths: ["/gallery/"] },
    { kind: "MEDIA_WITHDRAWN", mediaId: "m", usedOnPaths: ["/gallery/"] },
    { kind: "SETTINGS_PUBLISHED", revisionId: "r" },
  ] as const;

  for (const event of routineEdits) {
    assert.equal(requiresPublicDeployment(event), false, `${event.kind} must not need a deploy`);
  }
});

test("an unrecognised event neither purges everything nor silently does nothing", () => {
  const plan = planInvalidation({ kind: "TEMPLATE_CHANGED" } as never);
  assert.deepEqual(plan.paths, []);
  assert.match(plan.reason, /unsupported publish event/);
  // It must be reported as needing the guarded deploy rather than ignored.
  assert.equal(requiresPublicDeployment({ kind: "TEMPLATE_CHANGED" } as never), true);
});
