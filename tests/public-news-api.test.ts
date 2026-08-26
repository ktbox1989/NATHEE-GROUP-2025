import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_CMS_CONTRACT_VERSION, type PublicMedia } from "../lib/public-cms/contract.ts";
import { postPath, type PublicPost } from "../lib/public-cms/posts.ts";
import { buildPublicMediaPath } from "../lib/public-media-delivery.ts";
import {
  PUBLIC_NEWS_DEFAULT_LIMIT,
  PUBLIC_NEWS_MAX_LIMIT,
  decodePublicNewsCursor,
  handlePublicNewsDetailRequest,
  handlePublicNewsListRequest,
  type PublicNewsApiSource,
} from "../lib/public-news-api-contract.ts";

const media: PublicMedia = {
  id: "photo-1",
  altText: "รถบรรทุกขนส่งรถจักรยานยนต์",
  caption: null,
  variants: [
    { src: buildPublicMediaPath({ itemId: "photo-1", role: "display", format: "jpeg" })!, width: 1600, height: 900, format: "jpeg", role: "display" },
    { src: buildPublicMediaPath({ itemId: "photo-1", role: "display", format: "webp" })!, width: 1600, height: 900, format: "webp", role: "display" },
    { src: buildPublicMediaPath({ itemId: "photo-1", role: "thumbnail", format: "jpeg" })!, width: 640, height: 360, format: "jpeg", role: "thumbnail" },
  ],
};

function post(overrides: Partial<PublicPost> = {}): PublicPost {
  const slug = overrides.slug ?? "fleet-update";
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    status: "PUBLISHED",
    slug,
    path: postPath(slug),
    title: "อัปเดตกองรถขนส่ง",
    excerpt: "NATHEE GROUP เพิ่มความพร้อมสำหรับการขนส่งรถจักรยานยนต์ทั่วประเทศ",
    category: { id: "fleet", label: "กองรถ" },
    publishedAt: "2026-08-20T09:00:00.000Z",
    updatedAt: null,
    featuredImage: media,
    sections: [{ id: "body", heading: "รายละเอียด", headingLevel: 2, body: ["เนื้อหาข่าวที่เผยแพร่แล้ว"], media: [media] }],
    seo: {
      title: "อัปเดตกองรถขนส่ง | NATHEE GROUP 2025",
      description: "ข้อมูลล่าสุดเกี่ยวกับกองรถขนส่งของ NATHEE GROUP 2025",
      canonicalPath: postPath(slug),
      robots: "INDEX",
    },
    revisionId: "revision-never-public",
    ...overrides,
  };
}

function source(overrides: Partial<PublicNewsApiSource> = {}): PublicNewsApiSource {
  return {
    async list() { return { posts: [post()], next: null }; },
    async detail(slug) { return slug === "fleet-update" ? post() : null; },
    ...overrides,
  };
}

type TestPayload = {
  version?: number;
  items?: Array<Record<string, unknown>>;
  item?: { canonicalPath?: string; content?: unknown };
  nextCursor?: string | null;
};

async function body(response: Response): Promise<TestPayload> {
  return JSON.parse(await response.text()) as TestPayload;
}

test("public News list is anonymous, bounded, published-only data with the stable v1 shape", async () => {
  let receivedLimit = 0;
  const data = source({
    async list(input) {
      receivedLimit = input.limit;
      return { posts: [post()], next: null };
    },
  });
  const response = await handlePublicNewsListRequest(new Request("https://app.example/api/public/v1/news"), data);
  assert.equal(response.status, 200);
  assert.equal(receivedLimit, PUBLIC_NEWS_DEFAULT_LIMIT);
  assert.match(response.headers.get("Cache-Control") ?? "", /s-maxage=60/);
  const payload = await body(response);
  assert.equal(payload.version, 1);
  assert.equal(payload.items?.length, 1);
  assert.deepEqual(Object.keys(payload.items![0]), ["slug", "title", "excerpt", "publishedAt", "updatedAt", "canonicalPath", "cover", "seo"]);
  assert.deepEqual(payload.items![0].cover, {
    displayUrl: "/assets/media/photo-1/display.webp",
    thumbnailUrl: "/assets/media/photo-1/thumbnail.jpg",
  });
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["revision-never-public", "revisionId", "storageKey", "author", "audit", "postId"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not be public`);
  }
});

test("detail returns validated public sections and strips extra storage fields", async () => {
  const unsafe = post();
  (unsafe.sections[0].media[0] as PublicMedia & { storageKey: string }).storageKey = "private/original.heic";
  const response = await handlePublicNewsDetailRequest(
    new Request("https://app.example/api/public/v1/news/fleet-update"),
    "fleet-update",
    source({ async detail() { return unsafe; } }),
  );
  assert.equal(response.status, 200);
  const payload = await body(response);
  assert.equal(payload.item?.canonicalPath, "/news/fleet-update/");
  assert.ok(Array.isArray(payload.item?.content));
  assert.equal(JSON.stringify(payload).includes("storageKey"), false);
  assert.equal(JSON.stringify(payload).includes("private/original.heic"), false);
});

test("unknown, draft-only, unpublished and invalid slugs are indistinguishable 404s", async () => {
  const noPublishedRecord = source({ async detail() { return null; } });
  for (const slug of ["unknown-post", "draft-only", "hidden-post", "Bad_Slug", "../draft"]) {
    const response = await handlePublicNewsDetailRequest(
      new Request(`https://app.example/api/public/v1/news/${encodeURIComponent(slug)}`),
      slug,
      noPublishedRecord,
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
});

test("a malformed mapped record fails closed and private media is never returned", async () => {
  const privatePost = post({
    featuredImage: { ...media, variants: [{ ...media.variants[0], src: "/api/gallery/images/private" }] },
  });
  const list = await handlePublicNewsListRequest(
    new Request("https://app.example/api/public/v1/news"),
    source({ async list() { return { posts: [privatePost], next: null }; } }),
  );
  assert.deepEqual((await body(list)).items, []);
  const detail = await handlePublicNewsDetailRequest(
    new Request("https://app.example/api/public/v1/news/fleet-update"),
    "fleet-update",
    source({ async detail() { return privatePost; } }),
  );
  assert.equal(detail.status, 404);

  const wrongContract = post({ contractVersion: PUBLIC_CMS_CONTRACT_VERSION + 1 });
  const versioned = await handlePublicNewsListRequest(
    new Request("https://app.example/api/public/v1/news"),
    source({ async list() { return { posts: [wrongContract], next: null }; } }),
  );
  assert.deepEqual((await body(versioned)).items, []);
});

test("cursor pagination is opaque, deterministic and limit is capped", async () => {
  const key = { publishedAt: "2026-08-20 09:00:00", slug: "fleet-update" };
  let receivedAfter: unknown = null;
  const first = await handlePublicNewsListRequest(
    new Request(`https://app.example/api/public/v1/news?limit=${PUBLIC_NEWS_MAX_LIMIT}`),
    source({ async list() { return { posts: [post()], next: key }; } }),
  );
  const cursor = (await body(first)).nextCursor as string;
  assert.ok(cursor && !cursor.includes(key.slug));
  assert.deepEqual(decodePublicNewsCursor(cursor), key);

  const second = await handlePublicNewsListRequest(
    new Request(`https://app.example/api/public/v1/news?limit=1&cursor=${cursor}`),
    source({ async list(input) { receivedAfter = input.after; return { posts: [], next: null }; } }),
  );
  assert.equal(second.status, 200);
  assert.deepEqual(receivedAfter, key);

  for (const query of [`limit=${PUBLIC_NEWS_MAX_LIMIT + 1}`, "limit=0", "limit=-1", "limit=1.5", "cursor=not-a-cursor!"]) {
    const response = await handlePublicNewsListRequest(new Request(`https://app.example/api/public/v1/news?${query}`), source());
    assert.equal(response.status, 400, query);
  }
});

test("Cookie and Authorization cannot widen the public selection", async () => {
  let calls = 0;
  const data = source({ async list() { calls += 1; return { posts: [post()], next: null }; } });
  const anonymous = await handlePublicNewsListRequest(new Request("https://app.example/api/public/v1/news"), data);
  const credentialed = await handlePublicNewsListRequest(new Request("https://app.example/api/public/v1/news", {
    headers: { Authorization: "Bearer ignored", Cookie: "owner_session=ignored" },
  }), data);
  assert.equal(await anonymous.text(), await credentialed.text());
  assert.equal(calls, 2);
});

test("only GET and HEAD exist at the contract boundary", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const list = await handlePublicNewsListRequest(new Request("https://app.example/api/public/v1/news", { method }), source());
    const detail = await handlePublicNewsDetailRequest(
      new Request("https://app.example/api/public/v1/news/fleet-update", { method }),
      "fleet-update",
      source(),
    );
    for (const response of [list, detail]) {
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), "GET, HEAD");
    }
  }
});

test("database failure is a no-store 503 without stack, SQL or binding details", async () => {
  const data = source({
    async list() { throw new Error("SELECT secret FROM posts using binding DB\nstack trace"); },
    async detail() { throw new Error("D1 binding DB unavailable at private stack"); },
  });
  const responses = [
    await handlePublicNewsListRequest(new Request("https://app.example/api/public/v1/news"), data),
    await handlePublicNewsDetailRequest(new Request("https://app.example/api/public/v1/news/fleet-update"), "fleet-update", data),
  ];
  for (const response of responses) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const serialized = await response.text();
    for (const forbidden of ["SELECT", "binding", "stack", "posts"]) assert.equal(serialized.includes(forbidden), false);
  }
});

test("HEAD and ETag use the same representation without sending a body", async () => {
  const get = await handlePublicNewsListRequest(new Request("https://app.example/api/public/v1/news"), source());
  const etag = get.headers.get("ETag");
  assert.ok(etag);
  const head = await handlePublicNewsListRequest(new Request("https://app.example/api/public/v1/news", { method: "HEAD" }), source());
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("Content-Length"), get.headers.get("Content-Length"));
  const notModified = await handlePublicNewsListRequest(new Request("https://app.example/api/public/v1/news", {
    headers: { "If-None-Match": etag! },
  }), source());
  assert.equal(notModified.status, 304);
  assert.equal(await notModified.text(), "");
});
