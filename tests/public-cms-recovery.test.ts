import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_CMS_CONTRACT_VERSION, type PublicMedia, type PublicPage } from "../lib/public-cms/contract.ts";
import { postPath, type PublicPost } from "../lib/public-cms/posts.ts";
import {
  CMS_LOAD_TIMEOUT_MS,
  loadWithDeadline,
  resolvePage,
  resolvePost,
  type SourceEnvironment,
} from "../lib/public-cms/source.ts";
import { PREVIEW_MAX_TTL_SECONDS, createPreviewToken, verifyPreviewToken } from "../lib/public-cms/preview.ts";

const CMS_ON: SourceEnvironment = {
  PUBLIC_CMS_SOURCE: "CMS",
  PUBLIC_CMS_CONTRACT_VERSION: String(PUBLIC_CMS_CONTRACT_VERSION),
};

const media: PublicMedia = {
  id: "m1",
  altText: "รถบรรทุกขนส่งรถจักรยานยนต์",
  caption: null,
  variants: [{ src: "/assets/gallery/a-display.jpg", width: 1600, height: 900, format: "jpeg", role: "display" }],
};

function page(overrides: Partial<PublicPage> = {}): PublicPage {
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    slug: "services",
    path: "/services/",
    status: "PUBLISHED",
    heading: "บริการขนส่ง",
    seo: { title: "บริการ", description: "รายละเอียดบริการ", canonicalPath: "/services/", robots: "INDEX" },
    sections: [{ id: "s1", heading: "งานจริง", headingLevel: 2, body: ["เนื้อหา"], media: [media] }],
    revisionId: "rev-1",
    publishedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function post(overrides: Partial<PublicPost> = {}): PublicPost {
  const slug = overrides.slug ?? "new-truck";
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    status: "PUBLISHED",
    slug,
    path: postPath(slug),
    title: "รับมอบรถบรรทุกคันใหม่",
    excerpt: "เพิ่มกำลังขนส่ง",
    category: null,
    publishedAt: "2026-08-01T09:00:00.000Z",
    updatedAt: null,
    featuredImage: null,
    sections: [],
    seo: { title: "ข่าว", description: "รายละเอียด", canonicalPath: postPath(slug), robots: "INDEX" },
    revisionId: "rev-1",
    ...overrides,
  };
}

const staticReason = (result: { source: string; reason?: string }) => (result.source === "STATIC" ? result.reason ?? "" : "");

// --- a CMS that is slow is worse than a CMS that is down -------------------

test("a CMS that never answers falls back rather than holding the request open", async () => {
  // A rejected promise falls back immediately. One that never settles holds
  // the request until something upstream gives up, and what the visitor
  // eventually sees is a gateway error page — not the static release.
  const hang = () => new Promise<unknown>(() => {});
  const started = Date.now();
  const result = await resolvePage("/services/", CMS_ON, hang, { timeoutMs: 40 });
  assert.equal(result.source, "STATIC");
  assert.match(staticReason(result), /did not answer within 40ms/);
  assert.ok(Date.now() - started < 2000, "the fallback must not wait for the hung load");
});

test("a load that resolves before the deadline is used", async () => {
  const slow = () => new Promise<unknown>((resolve) => setTimeout(() => resolve(page()), 5));
  const result = await resolvePage("/services/", CMS_ON, slow, { timeoutMs: 500 });
  assert.equal(result.source, "CMS");
});

test("a load that rejects after timing out does not become an unhandled rejection", async () => {
  // On a worker runtime an unhandled rejection can take down the isolate,
  // which is the outage the fallback exists to survive.
  let rejectLater: (error: Error) => void = () => {};
  const late = () => new Promise<unknown>((_, reject) => { rejectLater = reject; });
  const result = await loadWithDeadline(late, 20);
  assert.equal(result.ok, false);
  rejectLater(new Error("too late"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  // Reaching here without the process reporting an unhandled rejection is the
  // assertion; node --test fails the run otherwise.
  assert.ok(true);
});

test("the default deadline is short enough to be a fallback rather than a hang", () => {
  assert.ok(CMS_LOAD_TIMEOUT_MS > 0 && CMS_LOAD_TIMEOUT_MS <= 5000);
});

// --- every other way a CMS fails -------------------------------------------

test("a loader that throws, synchronously or asynchronously, falls back", async () => {
  const asyncThrow = async () => {
    throw new Error("connection reset");
  };
  const syncThrow = () => {
    throw new Error("misconfigured client");
  };

  const first = await resolvePage("/services/", CMS_ON, asyncThrow);
  assert.equal(first.source, "STATIC");
  assert.match(staticReason(first), /connection reset/);

  const second = await resolvePage("/services/", CMS_ON, syncThrow as () => Promise<unknown>);
  assert.equal(second.source, "STATIC");
  assert.match(staticReason(second), /misconfigured client/);
});

test("a response that is not JSON falls back instead of rendering a parse error", async () => {
  // What a proxy error page actually looks like to a JSON client.
  const html = async () => {
    JSON.parse("<html><body>502 Bad Gateway</body></html>");
    return null;
  };
  const result = await resolvePage("/services/", CMS_ON, html);
  assert.equal(result.source, "STATIC");
  assert.match(staticReason(result), /CMS load failed/);
});

test("an empty response is a fallback, not an empty page", async () => {
  for (const payload of [null, undefined]) {
    const result = await resolvePage("/services/", CMS_ON, async () => payload);
    assert.equal(result.source, "STATIC");
    assert.match(staticReason(result), /no page/);
  }
});

test("a payload that does not match the schema is refused whole", async () => {
  const drifted = { ...page(), heading: undefined, sections: "not an array" };
  const result = await resolvePage("/services/", CMS_ON, async () => drifted);
  assert.equal(result.source, "STATIC");
  assert.match(staticReason(result), /consumer contract/);
  assert.ok(result.source === "STATIC" && (result.violations?.length ?? 0) > 0, "the violations are reported, not swallowed");
});

test("a payload from a newer CMS is refused rather than partially rendered", async () => {
  const newer = { ...page(), contractVersion: PUBLIC_CMS_CONTRACT_VERSION + 1 };
  const result = await resolvePage("/services/", CMS_ON, async () => newer);
  assert.equal(result.source, "STATIC");
});

test("media that cannot be shown does not take the page down, unless it is unsafe", async () => {
  // A private path is refused whole: this is the rule that keeps customer
  // evidence off the marketing site, so it is not a degradation case.
  const leaking = page({
    sections: [
      {
        id: "s1",
        heading: "งานจริง",
        headingLevel: 2,
        body: ["เนื้อหา"],
        media: [{ ...media, variants: [{ src: "/api/motorcycles/1/photo.jpg", width: 800, height: 600, format: "jpeg", role: "display" }] }],
      },
    ],
  });
  const result = await resolvePage("/services/", CMS_ON, async () => leaking);
  assert.equal(result.source, "STATIC", "a private media path must never reach a visitor");

  // A section that simply has no image is fine and still renders its copy.
  const noMedia = page({ sections: [{ id: "s1", heading: "งานจริง", headingLevel: 2, body: ["เนื้อหา"], media: [] }] });
  const kept = await resolvePage("/services/", CMS_ON, async () => noMedia);
  assert.equal(kept.source, "CMS");
});

test("an unpublished page falls back rather than rendering a draft", async () => {
  for (const status of ["DRAFT", "HIDDEN", "SCHEDULED", "ARCHIVED"]) {
    const result = await resolvePage("/services/", CMS_ON, async () => ({ ...page(), status }));
    assert.equal(result.source, "STATIC", `${status} must not render`);
  }
});

test("a page delivered for the wrong route is refused", async () => {
  // Otherwise a CMS misconfiguration silently serves the About copy at
  // /services/, which no validator would catch.
  const result = await resolvePage("/services/", CMS_ON, async () => page({ path: "/about/", seo: { ...page().seo, canonicalPath: "/about/" } }));
  assert.equal(result.source, "STATIC");
  assert.match(staticReason(result), /returned \/about\/ for \/services\//);
});

// --- the boundary itself ----------------------------------------------------

test("the boundary stays closed unless it is deliberately opened", async () => {
  const load = async () => page();
  for (const environment of [
    {},
    { PUBLIC_CMS_SOURCE: "STATIC" },
    { PUBLIC_CMS_SOURCE: "CMS" },
    { PUBLIC_CMS_SOURCE: "CMS", PUBLIC_CMS_CONTRACT_VERSION: "0" },
    { PUBLIC_CMS_SOURCE: "CMS", PUBLIC_CMS_CONTRACT_VERSION: "999" },
    { PUBLIC_CMS_SOURCE: "cms " },
  ] as SourceEnvironment[]) {
    const result = await resolvePage("/services/", environment, load);
    assert.equal(result.source, "STATIC", `${JSON.stringify(environment)} must not open the boundary`);
  }
  // Only the exact pair opens it.
  assert.equal((await resolvePage("/services/", CMS_ON, load)).source, "CMS");
});

test("with the boundary open but no loader wired, the static release still serves", async () => {
  const result = await resolvePage("/services/", CMS_ON);
  assert.equal(result.source, "STATIC");
  assert.match(staticReason(result), /no CMS loader/);
});

// --- posts have no static release to fall back to --------------------------

test("a post resolves under the same rules as a page", async () => {
  const result = await resolvePost(postPath("new-truck"), CMS_ON, async () => post());
  assert.equal(result.source, "CMS");
});

test("every page failure mode fails a post the same way", async () => {
  const path = postPath("new-truck");
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["outage", async () => { throw new Error("down"); }],
    ["empty", async () => null],
    ["draft", async () => ({ ...post(), status: "DRAFT" })],
    ["schema drift", async () => ({ ...post(), excerpt: "" })],
    ["wrong route", async () => post({ slug: "other-post" })],
    ["bad slug", async () => ({ ...post(), slug: "Not A Slug" })],
  ];
  for (const [name, load] of cases) {
    const result = await resolvePost(path, CMS_ON, load);
    assert.equal(result.source, "STATIC", `${name} must not render`);
  }
  const hung = await resolvePost(path, CMS_ON, () => new Promise<unknown>(() => {}), { timeoutMs: 20 });
  assert.equal(hung.source, "STATIC");
});

// --- preview tokens ---------------------------------------------------------

const SECRET = "a-preview-secret-that-is-long-enough-32";

test("an expired preview token is refused, so a shared link stops working", async () => {
  const now = Date.UTC(2026, 7, 1, 12, 0, 0);
  const token = await createPreviewToken({ path: "/services/", revisionId: "rev-1" }, SECRET, now, 60);
  assert.equal((await verifyPreviewToken(token, { path: "/services/" }, SECRET, now + 30_000)).ok, true);

  const stale = await verifyPreviewToken(token, { path: "/services/" }, SECRET, now + 61_000);
  assert.equal(stale.ok, false);
  assert.equal(stale.ok === false && stale.reason, "expired");
});

test("a preview token cannot be replayed against another page or a later draft", async () => {
  const now = Date.UTC(2026, 7, 1, 12, 0, 0);
  const token = await createPreviewToken({ path: "/services/", revisionId: "rev-1" }, SECRET, now);

  const elsewhere = await verifyPreviewToken(token, { path: "/about/" }, SECRET, now + 1000);
  assert.equal(elsewhere.ok, false);

  const laterDraft = await verifyPreviewToken(token, { path: "/services/", revisionId: "rev-2" }, SECRET, now + 1000);
  assert.equal(laterDraft.ok, false);
});

test("a preview token minted with an over-long life is refused whatever signed it", async () => {
  const now = Date.UTC(2026, 7, 1, 12, 0, 0);
  await assert.rejects(
    () => createPreviewToken({ path: "/services/", revisionId: "rev-1" }, SECRET, now, PREVIEW_MAX_TTL_SECONDS + 1),
    /ttl/,
  );
});

test("a tampered or absent token is refused without saying which part failed", async () => {
  const now = Date.UTC(2026, 7, 1, 12, 0, 0);
  const token = await createPreviewToken({ path: "/services/", revisionId: "rev-1" }, SECRET, now);
  const reasons = new Set<string>();
  for (const candidate of [null, undefined, "", "no-dot", `${token}x`, token.replace(/.$/, "0")]) {
    const verdict = await verifyPreviewToken(candidate, { path: "/services/" }, SECRET, now + 1000);
    assert.equal(verdict.ok, false);
    if (verdict.ok === false) reasons.add(verdict.reason);
  }
  // Generic reasons for the caller to log; the visitor is never told which
  // part failed, or the token becomes an oracle.
  for (const reason of reasons) assert.ok(reason.length < 40, `reason "${reason}" is too specific`);
});

test("a weak or absent preview secret fails closed rather than signing anything", async () => {
  const now = Date.UTC(2026, 7, 1, 12, 0, 0);
  for (const secret of [undefined, "", "short", "a".repeat(31)]) {
    await assert.rejects(
      () => createPreviewToken({ path: "/services/", revisionId: "rev-1" }, secret as string, now),
      /secret/,
    );
    await assert.rejects(() => verifyPreviewToken("anything", { path: "/services/" }, secret as string, now), /secret/);
  }
});
