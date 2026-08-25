// Where CMS-managed media is served from, stated as a contract rather than left
// to a deployment guess.
//
// Lane A's public contract accepts a media source only when it is a same-origin
// path under `/assets/`, and refuses `/api/`, `/app/`, `/auth/` and `/_next/`
// outright — those are the authenticated routes, and a public payload that
// pointed at one would be a customer's evidence photograph on a marketing page.
// That rule is right, and it is why the existing gallery image route
// (`/api/gallery/images/<id>`) can never appear in a public payload however
// carefully it checks the row it serves.
//
// So managed media needs a public path of its own. This file is that path, and
// nothing more: a deterministic, reversible mapping between a gallery item's
// identity and a URL. It knows nothing about R2, D1 or hosting, so the same
// rule can be checked by the route that serves the bytes, by the resolver that
// writes the URLs into a payload, and by a test, without any of the three
// agreeing by accident.
//
// What is deliberately NOT decided here is the host. The path is host-relative
// by construction, which is the whole point: whether `/assets/media/…` is
// answered by the application origin directly, or by the public origin
// forwarding to it, is a deployment decision. Inventing a hostname here would
// produce URLs that pass every contract check and 404 for a visitor.

/** The public prefix. Under `/assets/`, so Lane A's contract accepts it. */
export const PUBLIC_MEDIA_PATH_PREFIX = "/assets/media/";

/**
 * Roles a visitor may be served.
 *
 * `ORIGINAL` is absent on purpose. It is the untouched upload — up to 20 MB,
 * possibly HEIC, and carrying whatever metadata the camera wrote, including
 * location. It exists so the library can re-derive variants, not so it can be
 * fetched by anyone who can guess a URL.
 */
export const PUBLIC_MEDIA_ROLES = ["display", "thumbnail"] as const;
export type PublicMediaRole = (typeof PUBLIC_MEDIA_ROLES)[number];

/** The formats Lane A's contract can render. HEIC and HEIF are not among them. */
export const PUBLIC_MEDIA_FORMATS = ["avif", "webp", "jpeg", "png"] as const;
export type PublicMediaFormat = (typeof PUBLIC_MEDIA_FORMATS)[number];

/**
 * A gallery item id. Wide enough for both identities that exist today — the
 * UUID a D1 upload gets and the hyphenated slug the Owner-supplied manifest
 * uses — and narrow enough that a path segment can never be a traversal, an
 * encoded byte or a storage key.
 */
const ITEM_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

const EXTENSION_BY_FORMAT: Readonly<Record<PublicMediaFormat, string>> = Object.freeze({
  avif: "avif",
  webp: "webp",
  jpeg: "jpg",
  png: "png",
});

const FORMAT_BY_EXTENSION: Readonly<Record<string, PublicMediaFormat>> = Object.freeze({
  avif: "avif",
  webp: "webp",
  jpg: "jpeg",
  png: "png",
});

const FORMAT_BY_CONTENT_TYPE: Readonly<Record<string, PublicMediaFormat>> = Object.freeze({
  "image/avif": "avif",
  "image/webp": "webp",
  "image/jpeg": "jpeg",
  "image/png": "png",
});

const CONTENT_TYPE_BY_FORMAT: Readonly<Record<PublicMediaFormat, string>> = Object.freeze({
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
});

/** The stored variant roles, as the database spells them. */
const ROLE_BY_STORED: Readonly<Record<string, PublicMediaRole>> = Object.freeze({
  DISPLAY: "display",
  THUMBNAIL: "thumbnail",
});

export function isPublicGalleryItemId(value: unknown): value is string {
  return typeof value === "string" && ITEM_ID_PATTERN.test(value);
}

/**
 * The format a stored `content_type` is served as, or null.
 *
 * Null is the answer for `image/heic` and `image/heif`: the library accepts
 * them on upload because a phone produces them, and no browser is required to
 * decode either, so neither may be handed to a visitor.
 */
export function publicMediaFormatForContentType(contentType: string): PublicMediaFormat | null {
  return FORMAT_BY_CONTENT_TYPE[contentType] ?? null;
}

export function contentTypeForPublicMediaFormat(format: PublicMediaFormat): string {
  return CONTENT_TYPE_BY_FORMAT[format];
}

/** The public role a stored variant role maps to, or null for `ORIGINAL`. */
export function publicMediaRoleForStoredRole(role: string): PublicMediaRole | null {
  return ROLE_BY_STORED[role] ?? null;
}

export type PublicMediaLocator = {
  itemId: string;
  role: PublicMediaRole;
  format: PublicMediaFormat;
};

/**
 * The path a visitor requests for one variant.
 *
 * One file per role and format, which is exactly what the unique index on
 * (item, role, content type) already guarantees, so the URL is a true identity
 * rather than a query that could match twice.
 */
export function buildPublicMediaPath(locator: PublicMediaLocator): string | null {
  if (!isPublicGalleryItemId(locator?.itemId)) return null;
  if (!PUBLIC_MEDIA_ROLES.includes(locator.role)) return null;
  if (!PUBLIC_MEDIA_FORMATS.includes(locator.format)) return null;
  return `${PUBLIC_MEDIA_PATH_PREFIX}${locator.itemId}/${locator.role}.${EXTENSION_BY_FORMAT[locator.format]}`;
}

/**
 * The reverse, for the route that has to answer one.
 *
 * Parsing rather than pattern-matching the request is deliberate: the route
 * then serves exactly the identities this file can produce, so a path it would
 * never have written cannot be answered. Encoded separators, traversal, a
 * missing segment, an extra segment and an unknown extension are all null, and
 * null is a 404 rather than an error — a URL that is not one of ours is simply
 * not here.
 */
export function parsePublicMediaPath(path: unknown): PublicMediaLocator | null {
  if (typeof path !== "string" || !path.startsWith(PUBLIC_MEDIA_PATH_PREFIX)) return null;
  if (path.includes("..") || path.includes("%") || path.includes("\\")) return null;

  const remainder = path.slice(PUBLIC_MEDIA_PATH_PREFIX.length);
  const segments = remainder.split("/");
  if (segments.length !== 2) return null;

  const [itemId, file] = segments;
  if (!isPublicGalleryItemId(itemId)) return null;

  const dot = file.lastIndexOf(".");
  if (dot <= 0) return null;
  const role = file.slice(0, dot);
  const format = FORMAT_BY_EXTENSION[file.slice(dot + 1)];
  if (!format) return null;
  if (!PUBLIC_MEDIA_ROLES.includes(role as PublicMediaRole)) return null;

  return { itemId, role: role as PublicMediaRole, format };
}

/**
 * How long a shared cache may keep a public variant.
 *
 * A variant is immutable for its identity: the upload path writes one object
 * per (item, role, content type) and never overwrites it, so a changed
 * photograph is a new item with a new id and a new URL. Withdrawing one is
 * therefore a matter of the item's row, which is why this is a bounded age and
 * not `immutable` — an item taken out of PUBLIC must stop being served within a
 * knowable window even from a cache nobody can purge.
 */
export const PUBLIC_MEDIA_MAX_AGE_SECONDS = 3600;
export const PUBLIC_MEDIA_STALE_WHILE_REVALIDATE_SECONDS = 86400;
export const PUBLIC_MEDIA_CACHE_CONTROL =
  `public, max-age=${PUBLIC_MEDIA_MAX_AGE_SECONDS}, stale-while-revalidate=${PUBLIC_MEDIA_STALE_WHILE_REVALIDATE_SECONDS}`;
