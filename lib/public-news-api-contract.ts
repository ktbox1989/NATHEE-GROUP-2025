import {
  PUBLIC_CMS_CONTRACT_VERSION,
  validateMedia,
  type PublicMedia,
  type PublicSection,
} from "./public-cms/contract.ts";
import { isValidPostSlug, validatePublicPost, type PublicPost } from "./public-cms/posts.ts";
import type { PublishedNewsCursorKey } from "./public-news-selection.ts";

export const PUBLIC_NEWS_API_VERSION = 1;
export const PUBLIC_NEWS_DEFAULT_LIMIT = 20;
export const PUBLIC_NEWS_MAX_LIMIT = 50;
export const PUBLIC_NEWS_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
const ERROR_CACHE_CONTROL = "private, no-store";
const ALLOWED_METHODS = "GET, HEAD";

export type PublicNewsCover = { displayUrl: string; thumbnailUrl: string };
export type PublicNewsSeo = { title: string; description: string; robots: "INDEX" | "NOINDEX" };

export type PublicNewsListItem = {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  updatedAt: string | null;
  canonicalPath: string;
  cover: PublicNewsCover | null;
  seo: PublicNewsSeo;
};

export type PublicNewsDetailItem = PublicNewsListItem & { content: PublicSection[] };

export type PublicNewsApiSource = {
  list(input: { limit: number; after: PublishedNewsCursorKey | null }): Promise<{
    posts: PublicPost[];
    next: PublishedNewsCursorKey | null;
  }>;
  detail(slug: string): Promise<PublicPost | null>;
};

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) throw new Error("invalid cursor encoding");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export function encodePublicNewsCursor(key: PublishedNewsCursorKey): string {
  return encodeBase64Url(JSON.stringify({ v: 1, p: key.publishedAt, s: key.slug }));
}

export function decodePublicNewsCursor(value: string): PublishedNewsCursorKey | null {
  try {
    const parsed = JSON.parse(decodeBase64Url(value)) as { v?: unknown; p?: unknown; s?: unknown };
    if (parsed.v !== 1 || typeof parsed.p !== "string" || typeof parsed.s !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(parsed.p) || !isValidPostSlug(parsed.s)) return null;
    return { publishedAt: parsed.p, slug: parsed.s };
  } catch {
    return null;
  }
}

function coverFor(media: PublicMedia | null): PublicNewsCover | null {
  if (!media || validateMedia(media, "cover").length > 0) return null;
  const display = media.variants.find((variant) => variant.role === "display" && variant.format === "webp")
    ?? media.variants.find((variant) => variant.role === "display");
  if (!display) return null;
  const thumbnail = media.variants.find((variant) => variant.role === "thumbnail" && variant.format === "webp")
    ?? media.variants.find((variant) => variant.role === "thumbnail")
    ?? display;
  return { displayUrl: display.src, thumbnailUrl: thumbnail.src };
}

function sanitizeMedia(media: PublicMedia): PublicMedia {
  return {
    id: media.id,
    altText: media.altText,
    caption: media.caption,
    variants: media.variants.map((variant) => ({
      src: variant.src,
      width: variant.width,
      height: variant.height,
      format: variant.format,
      role: variant.role,
    })),
  };
}

function sanitizeSections(sections: readonly PublicSection[]): PublicSection[] {
  return sections.map((section) => ({
    id: section.id,
    heading: section.heading,
    headingLevel: section.headingLevel,
    body: [...section.body],
    media: section.media.map(sanitizeMedia),
  }));
}

export function mapPublicPostToNewsListItem(post: PublicPost): PublicNewsListItem | null {
  const validated = validatePublicPost(post, PUBLIC_CMS_CONTRACT_VERSION);
  if (!validated.ok || validated.value.status !== "PUBLISHED") return null;
  const value = validated.value;
  return {
    slug: value.slug,
    title: value.title,
    excerpt: value.excerpt,
    publishedAt: value.publishedAt,
    updatedAt: value.updatedAt,
    canonicalPath: value.seo.canonicalPath,
    cover: coverFor(value.featuredImage),
    seo: { title: value.seo.title, description: value.seo.description, robots: value.seo.robots },
  };
}

export function mapPublicPostToNewsDetailItem(post: PublicPost): PublicNewsDetailItem | null {
  const item = mapPublicPostToNewsListItem(post);
  if (!item) return null;
  return { ...item, content: sanitizeSections(post.sections) };
}

function jsonError(status: number, code: string, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ version: PUBLIC_NEWS_API_VERSION, error: { code } }), {
    status,
    headers: {
      "Cache-Control": ERROR_CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

async function representation(
  request: Request,
  payload: unknown,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const tag = `"${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
  const headers = new Headers({
    "Cache-Control": PUBLIC_NEWS_CACHE_CONTROL,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(new TextEncoder().encode(body).byteLength),
    ETag: tag,
    "X-Content-Type-Options": "nosniff",
  });
  if (request.headers.get("If-None-Match") === tag) {
    headers.delete("Content-Length");
    headers.delete("Content-Type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

function parseLimit(url: URL): number | null {
  const raw = url.searchParams.get("limit");
  if (raw === null) return PUBLIC_NEWS_DEFAULT_LIMIT;
  if (!/^[1-9]\d*$/u.test(raw)) return null;
  const limit = Number(raw);
  return Number.isSafeInteger(limit) && limit <= PUBLIC_NEWS_MAX_LIMIT ? limit : null;
}

function methodAllowed(request: Request): Response | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  return jsonError(405, "method_not_allowed", { Allow: ALLOWED_METHODS });
}

export async function handlePublicNewsListRequest(request: Request, source: PublicNewsApiSource): Promise<Response> {
  const methodError = methodAllowed(request);
  if (methodError) return methodError;
  const url = new URL(request.url);
  const limit = parseLimit(url);
  if (limit === null) return jsonError(400, "invalid_limit");
  const rawCursor = url.searchParams.get("cursor");
  const after = rawCursor === null ? null : decodePublicNewsCursor(rawCursor);
  if (rawCursor !== null && after === null) return jsonError(400, "invalid_cursor");

  try {
    const result = await source.list({ limit, after });
    const items = result.posts
      .map(mapPublicPostToNewsListItem)
      .filter((item): item is PublicNewsListItem => item !== null);
    return representation(request, {
      version: PUBLIC_NEWS_API_VERSION,
      items,
      nextCursor: result.next ? encodePublicNewsCursor(result.next) : null,
    });
  } catch {
    return jsonError(503, "service_unavailable");
  }
}

export async function handlePublicNewsDetailRequest(
  request: Request,
  slug: string,
  source: PublicNewsApiSource,
): Promise<Response> {
  const methodError = methodAllowed(request);
  if (methodError) return methodError;
  if (!isValidPostSlug(slug)) return jsonError(404, "not_found");
  try {
    const post = await source.detail(slug);
    const item = post ? mapPublicPostToNewsDetailItem(post) : null;
    if (!item) return jsonError(404, "not_found");
    return representation(request, { version: PUBLIC_NEWS_API_VERSION, item });
  } catch {
    return jsonError(503, "service_unavailable");
  }
}
