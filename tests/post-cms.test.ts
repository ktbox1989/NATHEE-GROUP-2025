import assert from "node:assert/strict";
import test from "node:test";
import { parsePostContent, parsePostContentJson, serializePostContent, type PostContent } from "../lib/post-cms-content.ts";
import { mapStoredPostToPublicPost, type PostMediaResolver } from "../lib/post-cms-public.ts";
import type { PublicMedia } from "../lib/public-cms/contract.ts";

const MEDIA: PublicMedia = {
  id: "gallery-hero-01",
  altText: "รถจักรยานยนต์ขึ้นรถบรรทุก",
  caption: null,
  variants: [
    { src: "/assets/media/hero-320.webp", width: 320, height: 180, format: "webp", role: "thumbnail" },
    { src: "/assets/media/hero-1280.webp", width: 1280, height: 720, format: "webp", role: "display" },
  ],
};

const resolveMedia: PostMediaResolver = (id) => (id === "gallery-hero-01" ? MEDIA : null);
const resolveNothing: PostMediaResolver = () => null;

function content(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    title: "เปิดเส้นทางขนส่งรถจักรยานยนต์สายใหม่",
    excerpt: "เพิ่มรอบขนส่งระหว่างกรุงเทพและเชียงใหม่ พร้อมลานพักรถระหว่างทาง",
    category: { id: "announcements", label: "ประกาศ" },
    featuredImageItemId: "gallery-hero-01",
    sections: [
      {
        id: "intro",
        type: "CONTENT",
        enabled: true,
        heading: "รอบขนส่งใหม่",
        body: "เริ่มให้บริการตั้งแต่เดือนหน้า",
        items: [],
      },
    ],
    seo: {
      title: "เส้นทางขนส่งสายใหม่",
      description: "รายละเอียดรอบขนส่งใหม่ระหว่างกรุงเทพและเชียงใหม่",
      robots: "INDEX",
    },
    ...overrides,
  };
}

const parsed = (overrides: Record<string, unknown> = {}) => parsePostContent(content(overrides));

test("a complete post parses and round-trips through JSON", () => {
  const value = parsed();
  assert.ok(value);
  assert.equal(value.seo.robots, "INDEX");
  assert.deepEqual(parsePostContentJson(serializePostContent(value)), value);
});

// The field Lane A needs to keep a post out of the index without unpublishing it.
test("robots accepts exactly INDEX and NOINDEX", () => {
  assert.equal(parsed({ seo: { title: "หัวข้อ SEO", description: "คำอธิบายที่ยาวพอสำหรับ meta description", robots: "NOINDEX" } })?.seo.robots, "NOINDEX");
  for (const robots of ["", "index", "noindex", "NONE", "ALL", null, 1]) {
    assert.equal(parsed({ seo: { title: "หัวข้อ SEO", description: "คำอธิบายที่ยาวพอสำหรับ meta description", robots } }), null, `robots ${JSON.stringify(robots)}`);
  }
});

test("a post without the fields the public list needs cannot be saved", () => {
  assert.equal(parsed({ title: "สั้น".slice(0, 1) }), null);
  assert.equal(parsed({ excerpt: "สั้นเกินไป" }), null);
  assert.equal(parsed({ seo: { title: "สั้น", description: "คำอธิบายที่ยาวพอสำหรับ meta description", robots: "INDEX" } }), null);
  assert.equal(parsed({ seo: { title: "หัวข้อ SEO", description: "สั้น", robots: "INDEX" } }), null);
});

test("structural mistakes are refused rather than repaired", () => {
  assert.equal(parsed({ sections: [] }), null);
  assert.equal(parsed({ version: 2 }), null);
  assert.equal(
    parsed({ sections: [{ id: "a", type: "CONTENT", enabled: true, heading: "ก", body: "", items: [] }, { id: "a", type: "CONTENT", enabled: true, heading: "ข", body: "", items: [] }] }),
    null,
    "duplicate section ids",
  );
  assert.equal(
    parsed({ sections: [{ id: "a", type: "CONTENT", enabled: false, heading: "ก", body: "", items: [] }] }),
    null,
    "every section disabled",
  );
  assert.equal(parsed({ sections: [{ id: "a", type: "FEATURES", enabled: true, heading: "ก", body: "", items: [] }] }), null, "FEATURES with no items");
  assert.equal(parsed({ category: { id: "bad id", label: "ประกาศ" } }), null);
});

// A content edit must not be able to become an open redirect.
test("an off-site call to action is refused", () => {
  const withHref = (href: string) =>
    parsed({
      sections: [{ id: "a", type: "CTA", enabled: true, heading: "ก", body: "", primaryLabel: "ดูเพิ่ม", primaryHref: href, items: [] }],
    });
  assert.ok(withHref("/quotation"));
  assert.ok(withHref("tel:0631941191"));
  for (const href of ["https://evil.test/x", "//evil.test/x", "javascript:alert(1)"]) {
    assert.equal(withHref(href), null, href);
  }
});

test("a label without a target, or a target without a label, is refused", () => {
  const section = (extra: Record<string, unknown>) =>
    parsed({ sections: [{ id: "a", type: "CTA", enabled: true, heading: "ก", body: "", items: [], ...extra }] });
  assert.equal(section({ primaryLabel: "ดูเพิ่ม" }), null);
  assert.equal(section({ primaryHref: "/quotation" }), null);
  assert.ok(section({ primaryLabel: "ดูเพิ่ม", primaryHref: "/quotation" }));
});

// The mapping is only useful if the public contract actually accepts it.
test("a stored post maps to a payload the public contract accepts", () => {
  const value = parsed() as PostContent;
  const result = mapStoredPostToPublicPost(
    { slug: "new-route-bangkok-chiangmai", revisionId: "rev-1", content: value, publishedAt: "2026-08-01T03:00:00.000Z", updatedAt: null },
    resolveMedia,
  );
  assert.ok(result.ok, JSON.stringify(result.ok ? {} : result.violations));
  assert.equal(result.post.status, "PUBLISHED");
  assert.equal(result.post.path, "/news/new-route-bangkok-chiangmai/");
  assert.equal(result.post.seo.canonicalPath, result.post.path, "canonical must be derived from the slug");
  assert.equal(result.post.updatedAt, null, "a post published once has never been edited");
  assert.equal(result.post.featuredImage?.id, "gallery-hero-01");
  assert.equal(result.post.sections[0].headingLevel, 2);
});

test("a republished post reports when it was edited", () => {
  const result = mapStoredPostToPublicPost(
    { slug: "new-route", revisionId: "rev-2", content: parsed() as PostContent, publishedAt: "2026-08-01T03:00:00.000Z", updatedAt: "2026-08-09T04:30:00.000Z" },
    resolveMedia,
  );
  assert.ok(result.ok);
  assert.equal(result.post.updatedAt, "2026-08-09T04:30:00.000Z");
});

test("feature entries become their own subsection at the next heading rank", () => {
  const value = parsed({
    sections: [
      {
        id: "why",
        type: "FEATURES",
        enabled: true,
        heading: "ทำไมต้องเรา",
        body: "",
        items: [{ title: "ตรวจสอบได้", body: "มีหลักฐานทุกขั้นตอน" }],
      },
    ],
  }) as PostContent;
  const result = mapStoredPostToPublicPost(
    { slug: "why-us", revisionId: "rev-1", content: value, publishedAt: "2026-08-01T03:00:00.000Z", updatedAt: null },
    resolveNothing,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.post.sections.map((section) => section.headingLevel), [2, 3]);
  assert.equal(result.post.sections[1].heading, "ตรวจสอบได้");
});

test("a disabled section is not published", () => {
  const value = parsed({
    sections: [
      { id: "shown", type: "CONTENT", enabled: true, heading: "แสดง", body: "", items: [] },
      { id: "hidden", type: "CONTENT", enabled: false, heading: "ซ่อน", body: "", items: [] },
    ],
  }) as PostContent;
  const result = mapStoredPostToPublicPost(
    { slug: "partial", revisionId: "rev-1", content: value, publishedAt: "2026-08-01T03:00:00.000Z", updatedAt: null },
    resolveNothing,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.post.sections.map((section) => section.id), ["shown"]);
});

// Media archived after publication must degrade, not render a broken image.
test("media that no longer resolves is dropped rather than emitted", () => {
  const result = mapStoredPostToPublicPost(
    { slug: "no-media", revisionId: "rev-1", content: parsed() as PostContent, publishedAt: "2026-08-01T03:00:00.000Z", updatedAt: null },
    resolveNothing,
  );
  assert.ok(result.ok);
  assert.equal(result.post.featuredImage, null);
  assert.deepEqual(result.post.sections[0].media, []);
});

// The slug rules are the public site's, so the mapper must not be able to
// publish a post at a URL the index or its pagination already owns.
test("a slug the public contract refuses cannot be mapped", () => {
  for (const slug of ["page", "feed", "sitemap", "Not-Lower", "-leading", "trailing-", "double--hyphen", ""]) {
    const result = mapStoredPostToPublicPost(
      { slug, revisionId: "rev-1", content: parsed() as PostContent, publishedAt: "2026-08-01T03:00:00.000Z", updatedAt: null },
      resolveMedia,
    );
    assert.equal(result.ok, false, `slug ${JSON.stringify(slug)} was accepted`);
  }
});
