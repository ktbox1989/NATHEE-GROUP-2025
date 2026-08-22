import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_CMS_CONTRACT_VERSION,
  PUBLIC_ROUTE_PATHS,
  isPrivateMediaPath,
  validateMedia,
  validateMediaSrc,
  validatePublicPage,
} from "../lib/public-cms/contract.ts";
import { resolveContentSource, resolvePage } from "../lib/public-cms/source.ts";

// The public site is CLOSED/PASS and serving real customers. Anything the CMS
// sends has to earn its way onto that page, so these tests are written from the
// position that the payload is untrusted.

function validMedia(overrides: Record<string, unknown> = {}) {
  return {
    id: "motorcycle-truck-loading-01",
    altText: "รถบรรทุกกำลังโหลดรถจักรยานยนต์",
    caption: null,
    variants: [
      { src: "/assets/gallery/a-thumbnail.webp", width: 640, height: 360, format: "webp", role: "thumbnail" },
      { src: "/assets/gallery/a-display.webp", width: 1600, height: 900, format: "webp", role: "display" },
    ],
    ...overrides,
  };
}

function validPage(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    slug: "services",
    path: "/services/",
    status: "PUBLISHED",
    heading: "บริการขนส่งที่วางแผนตามงานจริง",
    seo: {
      title: "บริการขนส่งรถจักรยานยนต์ครบวงจร | NATHEE GROUP 2025",
      description: "รวมบริการขนส่งรถจักรยานยนต์ทั่วประเทศและต่างประเทศ",
      canonicalPath: "/services/",
      robots: "INDEX",
    },
    sections: [
      { id: "overview", heading: "บริการทั้งหมด", headingLevel: 2, body: ["ข้อความ"], media: [validMedia()] },
    ],
    revisionId: "rev-1",
    publishedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}

test("a well-formed published page is accepted", () => {
  const result = validatePublicPage(validPage());
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.violations));
});

test("nothing but PUBLISHED can be rendered", () => {
  for (const status of ["DRAFT", "HIDDEN", "SCHEDULED", "ARCHIVED", "", null, undefined]) {
    const result = validatePublicPage(validPage({ status }));
    assert.equal(result.ok, false, `status ${String(status)} must be refused`);
    assert.ok(
      !result.ok && result.violations.some((violation) => violation.field === "status"),
      `status ${String(status)} must be refused for its status`,
    );
  }
});

test("a payload targeting another contract version is refused", () => {
  // This is what keeps the integration inactive until Lane B targets it.
  for (const version of [0, 2, 99, "1", null, undefined]) {
    const result = validatePublicPage(validPage({ contractVersion: version }));
    assert.equal(result.ok, false, `version ${String(version)} must be refused`);
  }
});

test("a page cannot claim a route the public site does not serve", () => {
  for (const path of ["/admin/", "/app/", "/services", "/unknown/", "//evil.example/"]) {
    const result = validatePublicPage(validPage({ path, seo: { ...validPage().seo, canonicalPath: path } }));
    assert.equal(result.ok, false, `path ${path} must be refused`);
  }
  for (const path of PUBLIC_ROUTE_PATHS) {
    const result = validatePublicPage(
      validPage({ path, seo: { ...validPage().seo, canonicalPath: path } }),
    );
    assert.equal(result.ok, true, `path ${path} must be accepted`);
  }
});

test("a canonical pointing away from the page is refused", () => {
  const page = validPage({ seo: { ...validPage().seo, canonicalPath: "/about/" } });
  const result = validatePublicPage(page);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.violations.some((violation) => violation.field === "seo.canonicalPath"));
});

test("authenticated media can never be published", () => {
  // The private evidence routes. A CMS bug that referenced one of these would
  // expose customer or job photography on the public website.
  for (const src of [
    "/api/images/abc?role=display",
    "/api/pod-signatures/abc",
    "/app/motorcycles/1/label",
    "/_next/static/x.png",
  ]) {
    assert.equal(isPrivateMediaPath(src), true, `${src} must be recognised as private`);
    assert.ok(validateMediaSrc(src, "src").length > 0, `${src} must be refused`);
  }
});

test("media sources must be same-origin public asset paths", () => {
  for (const src of [
    "https://evil.example/x.jpg",
    "//evil.example/x.jpg",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "/assets/../../etc/passwd",
    "/uploads/x.jpg",
    "",
  ]) {
    assert.ok(validateMediaSrc(src, "src").length > 0, `${src} must be refused`);
  }
  assert.equal(validateMediaSrc("/assets/gallery/a-display.webp", "src").length, 0);
});

test("public media must carry alt text and intrinsic dimensions", () => {
  assert.ok(validateMedia(validMedia({ altText: "" }), "m").length > 0, "empty alt must be refused");
  assert.ok(validateMedia(validMedia({ altText: "   " }), "m").length > 0, "blank alt must be refused");

  const noDimensions = validMedia({
    variants: [{ src: "/assets/gallery/a-display.webp", format: "webp", role: "display" }],
  });
  assert.ok(validateMedia(noDimensions, "m").length > 0, "missing width/height must be refused");

  const thumbnailOnly = validMedia({
    variants: [{ src: "/assets/gallery/a-thumbnail.webp", width: 640, height: 360, format: "webp", role: "thumbnail" }],
  });
  assert.ok(validateMedia(thumbnailOnly, "m").length > 0, "a display variant is required");
});

test("heading order cannot skip a level", () => {
  // The live site is already held to this; the data must not be able to break it.
  const skipping = validPage({
    sections: [
      { id: "a", heading: "หัวข้อ", headingLevel: 3, body: ["x"], media: [] },
    ],
  });
  const result = validatePublicPage(skipping);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.violations.some((violation) => violation.reason.includes("heading order jumps")));

  const ordered = validPage({
    sections: [
      { id: "a", heading: "สอง", headingLevel: 2, body: ["x"], media: [] },
      { id: "b", heading: "สาม", headingLevel: 3, body: ["x"], media: [] },
      { id: "c", heading: "สองอีก", headingLevel: 2, body: ["x"], media: [] },
    ],
  });
  assert.equal(validatePublicPage(ordered).ok, true);
});

test("the static release is the default source", () => {
  assert.equal(resolveContentSource().source, "STATIC");
  assert.equal(resolveContentSource({}).source, "STATIC");
  assert.equal(resolveContentSource({ PUBLIC_CMS_SOURCE: "STATIC" }).source, "STATIC");
  // Opting in is not enough on its own; the version gate still applies.
  assert.equal(resolveContentSource({ PUBLIC_CMS_SOURCE: "CMS" }).source, "STATIC");
  // A typo or a stale value must not silently enable the CMS.
  assert.equal(resolveContentSource({ PUBLIC_CMS_SOURCE: "CSM" }).source, "STATIC");
  assert.equal(resolveContentSource({ PUBLIC_CMS_SOURCE: "true" }).source, "STATIC");
  assert.equal(resolveContentSource({ PUBLIC_CMS_SOURCE: "1" }).source, "STATIC");
});

test("the opt-in token is normalised for case and whitespace", () => {
  const version = String(PUBLIC_CMS_CONTRACT_VERSION);
  for (const token of ["CMS", "cms", "  cms  ", "Cms"]) {
    assert.equal(
      resolveContentSource({ PUBLIC_CMS_SOURCE: token, PUBLIC_CMS_CONTRACT_VERSION: version }).source,
      "CMS",
      `"${token}" should opt in`,
    );
  }
});

test("the CMS cannot be enabled without a matching contract version", () => {
  assert.equal(resolveContentSource({ PUBLIC_CMS_SOURCE: "CMS" }).source, "STATIC");
  assert.equal(
    resolveContentSource({ PUBLIC_CMS_SOURCE: "CMS", PUBLIC_CMS_CONTRACT_VERSION: "2" }).source,
    "STATIC",
  );
  assert.equal(
    resolveContentSource({
      PUBLIC_CMS_SOURCE: "CMS",
      PUBLIC_CMS_CONTRACT_VERSION: String(PUBLIC_CMS_CONTRACT_VERSION),
    }).source,
    "CMS",
  );
});

const enabled = {
  PUBLIC_CMS_SOURCE: "CMS",
  PUBLIC_CMS_CONTRACT_VERSION: String(PUBLIC_CMS_CONTRACT_VERSION),
};

test("a CMS outage falls back to the static release instead of failing the page", async () => {
  const resolution = await resolvePage("/services/", enabled, async () => {
    throw new Error("D1 unavailable");
  });
  assert.equal(resolution.source, "STATIC");
  assert.ok(resolution.source === "STATIC" && resolution.reason.includes("CMS load failed"));
});

test("an invalid CMS payload is refused whole, never partially rendered", async () => {
  const resolution = await resolvePage("/services/", enabled, async () => validPage({ status: "DRAFT" }));
  assert.equal(resolution.source, "STATIC");
  assert.ok(resolution.source === "STATIC" && (resolution.violations?.length ?? 0) > 0);
});

test("the CMS cannot answer for a different route than the one requested", async () => {
  const resolution = await resolvePage("/about/", enabled, async () => validPage());
  assert.equal(resolution.source, "STATIC");
  assert.ok(resolution.source === "STATIC" && resolution.reason.includes("/services/"));
});

test("a valid published page is served from the CMS once enabled", async () => {
  const resolution = await resolvePage("/services/", enabled, async () => validPage());
  assert.equal(resolution.source, "CMS");
  assert.equal(resolution.source === "CMS" && resolution.page.path, "/services/");
});

test("with the boundary inactive the loader is never consulted", async () => {
  let called = false;
  const resolution = await resolvePage("/services/", {}, async () => {
    called = true;
    return validPage();
  });
  assert.equal(resolution.source, "STATIC");
  assert.equal(called, false, "the CMS must not be queried while the boundary is inactive");
});
