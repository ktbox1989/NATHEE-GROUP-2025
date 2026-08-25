import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { getDb } from "@/db";
import { galleryImageVariants, galleryItems } from "@/db/schema";
import {
  contentTypeForPublicMediaFormat,
  parsePublicMediaPath,
  PUBLIC_MEDIA_CACHE_CONTROL,
} from "@/lib/public-media-delivery";

/**
 * The public delivery route for CMS-managed media.
 *
 * It lives at `/assets/media/…` rather than under `/api/` because Lane A's
 * public contract refuses every authenticated prefix outright — a payload
 * pointing at `/api/gallery/images/<id>` is rejected before it can be rendered,
 * and rightly so. Managed media therefore needs a path that is public by its
 * shape, and this is it.
 *
 * This route is deliberately session-blind. It never resolves an actor, so
 * there is no per-viewer variation and the response is honestly shareable by a
 * cache. That is only safe because "may this be served" is decided entirely
 * from the stored row, in the query: PUBLISHED and PUBLIC, or nothing. A draft,
 * a hidden item, an archived one, an INTERNAL photograph and a customer's job
 * evidence are not filtered out after the fact — they never match.
 *
 * `ORIGINAL` has no public role in the delivery contract, so the untouched
 * upload — full resolution, camera metadata and all — has no URL here at all.
 *
 * Everything that is not exactly an identity this application could have
 * written answers 404: an unknown item, an unknown variant, a traversal, an
 * encoded separator, a format no browser is required to decode. A 404 rather
 * than a 403, because "there is no such image" is the truth and a distinct
 * status would confirm which ids exist.
 */
export async function GET(request: NextRequest) {
  // Parsed from the request path rather than reassembled from the route
  // parameters: the route then serves exactly the URLs the delivery contract
  // can produce, and a shape it would never have written cannot be answered.
  const locator = parsePublicMediaPath(request.nextUrl.pathname);
  if (!locator) return notFound();

  const db = getDb();
  const item = await db
    .select({ id: galleryItems.id })
    .from(galleryItems)
    .where(
      and(
        eq(galleryItems.id, locator.itemId),
        eq(galleryItems.status, "PUBLISHED"),
        eq(galleryItems.visibility, "PUBLIC"),
      ),
    )
    .get();
  if (!item) return notFound();

  const contentType = contentTypeForPublicMediaFormat(locator.format);
  const variant = await db
    .select({ storageKey: galleryImageVariants.storageKey, byteSize: galleryImageVariants.byteSize })
    .from(galleryImageVariants)
    .where(
      and(
        eq(galleryImageVariants.galleryItemId, item.id),
        eq(galleryImageVariants.role, locator.role === "display" ? "DISPLAY" : "THUMBNAIL"),
        eq(galleryImageVariants.contentType, contentType),
      ),
    )
    .get();
  if (!variant) return notFound();

  const object = await env.FILES.get(variant.storageKey);
  if (!object) return notFound();

  // Shareable, and bounded rather than immutable: a variant's bytes never
  // change for a given identity, but an item can be taken out of PUBLIC, and
  // that has to reach a cache nobody can purge within a knowable window.
  const validators = new Headers({ "Cache-Control": PUBLIC_MEDIA_CACHE_CONTROL });
  if (object.httpEtag) validators.set("ETag", object.httpEtag);

  // A 304 carries the validators and nothing that describes a body it is not
  // sending; a Content-Length on an empty response is a length that is not true.
  if (object.httpEtag && request.headers.get("If-None-Match") === object.httpEtag) {
    return new Response(null, { status: 304, headers: validators });
  }

  const headers = new Headers(validators);
  headers.set("Content-Type", contentType);
  headers.set("Content-Length", String(variant.byteSize));
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { status: 200, headers });
}

function notFound(): Response {
  // A miss must not be cached as though it were the answer: an item published
  // a minute later would otherwise keep 404ing for the life of the entry.
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
