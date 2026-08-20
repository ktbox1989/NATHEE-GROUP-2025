import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, galleryCategories, galleryImageVariants, galleryItems, transportJobs } from "@/db/schema";
import type { GalleryVariantRole, GalleryVisibility } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { boundedText, GALLERY_MAX_ORIGINAL_BYTES, GALLERY_MAX_VARIANT_BYTES, galleryVisibilities, parseGallerySortOrder, parsePositiveDimension } from "@/lib/gallery";
import { hasExpectedImageSignature, sha256Hex, SUPPORTED_IMAGE_TYPES } from "@/lib/image-validation";
import { isSameOrigin } from "@/lib/same-origin";

type PreparedVariant = { id: string; role: GalleryVariantRole; file: File; bytes: Uint8Array; checksum: string; width: number | null; height: number | null; storageKey: string };

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "gallery:write")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);

  const form = await request.formData();
  const requestKey = boundedText(form.get("requestKey"), 100);
  const categoryId = boundedText(form.get("categoryId"), 80);
  const title = boundedText(form.get("title"), 160);
  const caption = boundedText(form.get("caption"), 1000) || null;
  const altText = boundedText(form.get("altText"), 300);
  const takenAt = boundedText(form.get("takenAt"), 40) || null;
  const location = boundedText(form.get("location"), 200) || null;
  const publicJobReference = boundedText(form.get("publicJobReference"), 100) || null;
  const visibilityValue = boundedText(form.get("visibility"), 30).toUpperCase();
  const visibility = galleryVisibilities.has(visibilityValue as GalleryVisibility) ? visibilityValue as GalleryVisibility : null;
  const sortOrder = parseGallerySortOrder(form.get("sortOrder"));
  const companyId = boundedText(form.get("companyId"), 80) || null;
  const jobId = boundedText(form.get("jobId"), 80) || null;
  if (!requestKey || !categoryId || !title || altText.length < 3 || !visibility || sortOrder === undefined) return redirectError(request, "invalid_gallery");
  if ((visibility === "PUBLIC" && (companyId || jobId)) || (visibility === "CUSTOMER_JOB" && (!companyId || !jobId))) return redirectError(request, "invalid_scope");

  const db = getDb();
  const existing = await db.select({ id: galleryItems.id }).from(galleryItems).where(eq(galleryItems.requestKey, requestKey)).get();
  if (existing) return NextResponse.redirect(new URL(`/app/gallery?status=already_uploaded#${existing.id}`, request.url), 303);
  const category = await db.select({ id: galleryCategories.id }).from(galleryCategories).where(eq(galleryCategories.id, categoryId)).get();
  if (!category) return redirectError(request, "invalid_category");
  if (visibility === "CUSTOMER_JOB") {
    const job = await db.select({ id: transportJobs.id }).from(transportJobs).where(and(eq(transportJobs.id, jobId!), eq(transportJobs.companyId, companyId!))).get();
    if (!job) return redirectError(request, "invalid_job_scope");
  }

  const itemId = crypto.randomUUID();
  const variants: PreparedVariant[] = [];
  for (const spec of [
    { field: "original", role: "ORIGINAL" as const, max: GALLERY_MAX_ORIGINAL_BYTES },
    { field: "displayWebp", role: "DISPLAY" as const, max: GALLERY_MAX_VARIANT_BYTES },
    { field: "displayAvif", role: "DISPLAY" as const, max: GALLERY_MAX_VARIANT_BYTES },
    { field: "thumbnailWebp", role: "THUMBNAIL" as const, max: GALLERY_MAX_VARIANT_BYTES },
    { field: "thumbnailAvif", role: "THUMBNAIL" as const, max: GALLERY_MAX_VARIANT_BYTES },
  ]) {
    const value = form.get(spec.field);
    if (!(value instanceof File) || value.size === 0) continue;
    const prepared = await prepareVariant(value, spec.role, spec.max, itemId, form.get(`${spec.field}Width`), form.get(`${spec.field}Height`));
    if (!prepared) return redirectError(request, "invalid_image");
    variants.push(prepared);
  }
  if (!variants.some((value) => value.role === "ORIGINAL") || !variants.some((value) => value.role === "DISPLAY") || !variants.some((value) => value.role === "THUMBNAIL")) return redirectError(request, "missing_variant");

  const storedKeys: string[] = [];
  try {
    for (const variant of variants) {
      await env.FILES.put(variant.storageKey, variant.bytes, { httpMetadata: { contentType: variant.file.type }, customMetadata: { galleryItemId: itemId, role: variant.role, uploadedBy: actor.userId, checksum: variant.checksum } });
      storedKeys.push(variant.storageKey);
    }
    const now = new Date().toISOString();
    await db.batch([
      db.insert(galleryItems).values({ id: itemId, requestKey, categoryId, companyId, jobId, title, caption, altText, takenAt, location, publicJobReference, status: "DRAFT", visibility, sortOrder, uploadedBy: actor.userId, updatedAt: now }),
      ...variants.map((variant) => db.insert(galleryImageVariants).values({ id: variant.id, galleryItemId: itemId, role: variant.role, storageKey: variant.storageKey, contentType: variant.file.type, width: variant.width, height: variant.height, byteSize: variant.file.size, checksum: variant.checksum })),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE", entityType: "gallery_item", entityId: itemId, companyId, after: { categoryId, title, visibility, takenAt, location, publicJobReference, status: "DRAFT", variants: variants.map(({ role, file, checksum }) => ({ role, contentType: file.type, byteSize: file.size, checksum })) } })),
    ]);
  } catch {
    await Promise.all(storedKeys.map((key) => env.FILES.delete(key)));
    return redirectError(request, "gallery_save");
  }
  return NextResponse.redirect(new URL(`/app/gallery?status=uploaded#${itemId}`, request.url), 303);
}

async function prepareVariant(file: File, role: GalleryVariantRole, maxBytes: number, itemId: string, widthValue: FormDataEntryValue | null, heightValue: FormDataEntryValue | null): Promise<PreparedVariant | null> {
  if (file.size < 1 || file.size > maxBytes || !SUPPORTED_IMAGE_TYPES.has(file.type)) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !hasExpectedImageSignature(bytes, file.type)) return null;
  const width = parsePositiveDimension(widthValue);
  const height = parsePositiveDimension(heightValue);
  if (width === undefined || height === undefined) return null;
  const id = crypto.randomUUID();
  const checksum = await sha256Hex(bytes);
  const extension = SUPPORTED_IMAGE_TYPES.get(file.type)!;
  return { id, role, file, bytes, checksum, width, height, storageKey: `gallery/${itemId}/${role.toLowerCase()}-${id}.${extension}` };
}

function redirectError(request: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`/app/gallery?error=${encodeURIComponent(code)}`, request.url), 303);
}
