import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, siteSettingsRevisions } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { sha256Hex } from "@/lib/image-validation";
import { isSameOrigin } from "@/lib/same-origin";
import { parseSiteSettingsJson, serializeSiteSettings } from "@/lib/site-settings";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "site:write")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);
  const form = await request.formData();
  const requestKey = text(form.get("requestKey"), 120);
  const settingsRaw = String(form.get("settingsJson") ?? "");
  const changeNote = text(form.get("changeNote"), 500) || null;
  const settings = parseSiteSettingsJson(settingsRaw);
  if (!requestKey || !settings) return redirectError(request, "invalid_settings");
  const settingsJson = serializeSiteSettings(settings);
  const settingsHash = await sha256Hex(new TextEncoder().encode(settingsJson));
  const db = getDb();
  const existing = await db.select({ id: siteSettingsRevisions.id }).from(siteSettingsRevisions).where(eq(siteSettingsRevisions.requestKey, requestKey)).get();
  if (existing) return NextResponse.redirect(new URL(`/app/site-settings?status=already_saved&revision=${existing.id}`, request.url), 303);
  const revisionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await db.batch([
      db.insert(siteSettingsRevisions).values({ id: revisionId, requestKey, settingsJson, settingsHash, changeNote, createdBy: actor.userId, createdAt }),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE_SITE_SETTINGS_REVISION", entityType: "site_settings", entityId: revisionId, after: { revisionId, settingsHash, navigationCount: settings.navigation.items.length, logoConfigured: Boolean(settings.brand.logoItemId), changeNote } })),
    ]);
  } catch {
    const concurrent = await db.select({ id: siteSettingsRevisions.id }).from(siteSettingsRevisions).where(eq(siteSettingsRevisions.requestKey, requestKey)).get();
    if (concurrent) return NextResponse.redirect(new URL(`/app/site-settings?status=already_saved&revision=${concurrent.id}`, request.url), 303);
    return redirectError(request, "save_failed");
  }
  return NextResponse.redirect(new URL(`/app/site-settings?status=saved&revision=${revisionId}`, request.url), 303);
}

function redirectError(request: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`/app/site-settings?error=${encodeURIComponent(code)}`, request.url), 303);
}

function text(value: FormDataEntryValue | null, max: number) {
  return String(value ?? "").trim().slice(0, max);
}
