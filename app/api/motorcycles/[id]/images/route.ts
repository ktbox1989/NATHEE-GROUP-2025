import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, motorcycleImages, motorcycleImageVariants, motorcycles } from "@/db/schema";
import type { ImageCategory, MotorcycleImageVariantRole } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { hasExpectedImageSignature, sha256Hex, SUPPORTED_IMAGE_TYPES } from "@/lib/image-validation";
import {
  hasRequiredMotorcycleImageVariants,
  isMotorcycleImageRequestKey,
  motorcycleImageVariantByteLimit,
  MOTORCYCLE_IMAGE_MAX_ORIGINAL_BYTES,
  MOTORCYCLE_IMAGE_VARIANT_TYPES,
  parseMotorcycleImageDimension,
} from "@/lib/motorcycle-image-variants";
import { isSameOrigin } from "@/lib/same-origin";

const allowedCategories = new Set(["FRONT", "REAR", "LEFT", "RIGHT", "DAMAGE", "DELIVERY", "OTHER"]);
const MAX_REQUEST_BYTES = 24 * 1024 * 1024;

type PreparedVariant = {
  id: string;
  role: MotorcycleImageVariantRole;
  file: File;
  contentType: string;
  bytes: Uint8Array;
  checksum: string;
  width: number;
  height: number;
  storageKey: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return respondError(request, "forbidden", 403);
  const actor = await getCurrentActor();
  if (!actor) return respondError(request, "not_authorized", 401, "/login?error=not_authorized");
  const { id } = await context.params;
  const db = getDb();
  const motorcycle = await db.select({ id: motorcycles.id, companyId: motorcycles.companyId }).from(motorcycles).where(eq(motorcycles.id, id)).get();
  if (!motorcycle || !can(actor, "images:write", motorcycle.companyId)) return respondError(request, "forbidden", 403, "/app/motorcycles?error=forbidden");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return respondError(request, "request_too_large", 413, `/app/motorcycles/${id}?error=image`);

  const form = await request.formData();
  const requestKey = String(form.get("requestKey") ?? "").trim();
  const file = form.get("image");
  const category = String(form.get("category") ?? "OTHER").toUpperCase();
  if (!isMotorcycleImageRequestKey(requestKey)) return respondError(request, "invalid_request_key", 422, `/app/motorcycles/${id}?error=image`);
  const existing = await db.select({ id: motorcycleImages.id }).from(motorcycleImages).where(eq(motorcycleImages.requestKey, requestKey)).get();
  if (existing) return respondSuccess(request, existing.id, true, `/app/motorcycles/${id}?status=image_uploaded`);
  if (!(file instanceof File) || file.size < 1 || file.size > MOTORCYCLE_IMAGE_MAX_ORIGINAL_BYTES || !SUPPORTED_IMAGE_TYPES.has(file.type) || !allowedCategories.has(category)) return respondError(request, "invalid_image", 422, `/app/motorcycles/${id}?error=image`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !hasExpectedImageSignature(bytes, file.type)) return respondError(request, "invalid_image_type", 422, `/app/motorcycles/${id}?error=image_type`);

  const imageId = crypto.randomUUID();
  const storagePrefix = `companies/${motorcycle.companyId}/motorcycles/${id}/${imageId}`;
  const variants: PreparedVariant[] = [];
  for (const spec of [
    { field: "displayWebp", role: "DISPLAY" as const },
    { field: "displayAvif", role: "DISPLAY" as const },
    { field: "thumbnailWebp", role: "THUMBNAIL" as const },
    { field: "thumbnailAvif", role: "THUMBNAIL" as const },
  ]) {
    const value = form.get(spec.field);
    if (!(value instanceof File) || value.size === 0) continue;
    const prepared = await prepareVariant(value, spec.role, storagePrefix, form.get(`${spec.field}Width`), form.get(`${spec.field}Height`));
    if (!prepared) return respondError(request, "invalid_variant", 422, `/app/motorcycles/${id}?error=image_variant`);
    variants.push(prepared);
  }
  if (!hasRequiredMotorcycleImageVariants(variants)) return respondError(request, "missing_variant", 422, `/app/motorcycles/${id}?error=image_variant`);

  const extension = SUPPORTED_IMAGE_TYPES.get(file.type)!;
  const checksum = await sha256Hex(bytes);
  const storageKey = `${storagePrefix}.${extension}`;
  const storedKeys: string[] = [];
  try {
    await env.FILES.put(storageKey, bytes, { httpMetadata: { contentType: file.type }, customMetadata: { motorcycleId: id, companyId: motorcycle.companyId, uploadedBy: actor.userId, checksum, role: "ORIGINAL" } });
    storedKeys.push(storageKey);
    for (const variant of variants) {
      await env.FILES.put(variant.storageKey, variant.bytes, { httpMetadata: { contentType: variant.file.type }, customMetadata: { motorcycleId: id, motorcycleImageId: imageId, companyId: motorcycle.companyId, uploadedBy: actor.userId, checksum: variant.checksum, role: variant.role } });
      storedKeys.push(variant.storageKey);
    }
    const metadata = { id: imageId, requestKey, motorcycleId: id, companyId: motorcycle.companyId, storageKey, category: category as ImageCategory, contentType: file.type, byteSize: file.size, checksum, uploadedBy: actor.userId };
    await db.batch([
      db.insert(motorcycleImages).values(metadata),
      ...variants.map((variant) => db.insert(motorcycleImageVariants).values({ id: variant.id, motorcycleImageId: imageId, role: variant.role, storageKey: variant.storageKey, contentType: variant.file.type, width: variant.width, height: variant.height, byteSize: variant.file.size, checksum: variant.checksum })),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "UPLOAD_IMAGE", entityType: "motorcycle_image", entityId: imageId, companyId: motorcycle.companyId, after: { motorcycleId: id, category, contentType: file.type, byteSize: file.size, checksum, variants: variants.map(({ role, file: variantFile, width, height, checksum: variantChecksum }) => ({ role, contentType: variantFile.type, byteSize: variantFile.size, width, height, checksum: variantChecksum })) } })),
    ]);
  } catch {
    await Promise.all(storedKeys.map((key) => env.FILES.delete(key)));
    const raced = await db.select({ id: motorcycleImages.id }).from(motorcycleImages).where(eq(motorcycleImages.requestKey, requestKey)).get();
    if (raced) return respondSuccess(request, raced.id, true, `/app/motorcycles/${id}?status=image_uploaded`);
    return respondError(request, "image_save", 500, `/app/motorcycles/${id}?error=image_save`);
  }
  return respondSuccess(request, imageId, false, `/app/motorcycles/${id}?status=image_uploaded`);
}

async function prepareVariant(file: File, role: MotorcycleImageVariantRole, storagePrefix: string, widthValue: FormDataEntryValue | null, heightValue: FormDataEntryValue | null): Promise<PreparedVariant | null> {
  if (file.size < 1 || file.size > motorcycleImageVariantByteLimit(role) || !MOTORCYCLE_IMAGE_VARIANT_TYPES.has(file.type)) return null;
  const width = parseMotorcycleImageDimension(widthValue);
  const height = parseMotorcycleImageDimension(heightValue);
  if (!width || !height) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !hasExpectedImageSignature(bytes, file.type)) return null;
  const id = crypto.randomUUID();
  const checksum = await sha256Hex(bytes);
  const extension = SUPPORTED_IMAGE_TYPES.get(file.type)!;
  return { id, role, file, contentType: file.type, bytes, checksum, width, height, storageKey: `${storagePrefix}/variants/${role.toLowerCase()}-${id}.${extension}` };
}

function wantsJson(request: NextRequest): boolean {
  return request.headers.get("Accept")?.toLowerCase().includes("application/json") ?? false;
}

function respondSuccess(request: NextRequest, imageId: string, duplicate: boolean, location: string) {
  return wantsJson(request) ? NextResponse.json({ ok: true, imageId, duplicate }, { status: duplicate ? 200 : 201 }) : NextResponse.redirect(new URL(location, request.url), 303);
}

function respondError(request: NextRequest, error: string, status: number, location = `/app/motorcycles?error=${encodeURIComponent(error)}`) {
  return wantsJson(request) ? NextResponse.json({ ok: false, error }, { status }) : NextResponse.redirect(new URL(location, request.url), 303);
}
