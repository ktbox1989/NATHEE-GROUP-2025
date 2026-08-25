import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, siteSettingsPublicationEvents, siteSettingsRevisions } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { decidePublication, siteSettingsPublishEvent } from "@/lib/publication-events";
import { isSameOrigin } from "@/lib/same-origin";
import { collectSettingsReferences, firstUnpublishableLabel, unpublishableReferences } from "@/lib/site-cms-publish";
import { resolvePublishReferences } from "@/lib/site-cms-publish-store";
import { parseSiteSettingsJson } from "@/lib/site-settings";
import { recordTimestamp } from "@/lib/timestamps";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "site:publish")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);
  const form = await request.formData();
  const requestKey = text(form.get("requestKey"), 120);
  const revisionId = text(form.get("revisionId"), 100);
  const note = text(form.get("note"), 500) || null;
  if (!requestKey || !revisionId) return redirectError(request, "invalid_publish");
  const db = getDb();
  const existing = await db.select({ id: siteSettingsPublicationEvents.id }).from(siteSettingsPublicationEvents).where(eq(siteSettingsPublicationEvents.requestKey, requestKey)).get();
  if (existing) return NextResponse.redirect(new URL("/app/site-settings?status=already_published", request.url), 303);
  const revision = await db.select({ id: siteSettingsRevisions.id, settingsJson: siteSettingsRevisions.settingsJson }).from(siteSettingsRevisions).where(eq(siteSettingsRevisions.id, revisionId)).get();
  if (!revision) return redirectError(request, "revision_not_found");
  // The brand logo is shown on every public page, so publishing settings that
  // point at media a reader cannot be served would silently blank it site-wide.
  const settings = parseSiteSettingsJson(revision.settingsJson);
  if (!settings) return redirectError(request, "revision_unreadable");
  const references = collectSettingsReferences(settings);
  let problems;
  try {
    problems = unpublishableReferences(references, await resolvePublishReferences(references));
  } catch {
    return redirectError(request, "publish_failed");
  }
  if (problems.length > 0) {
    const label = firstUnpublishableLabel(problems);
    return NextResponse.redirect(new URL(`/app/site-settings?error=unpublishable_media${label ? `&missing=${encodeURIComponent(label)}` : ""}`, request.url), 303);
  }
  // Brand, navigation and the footer are rendered into every public page, so a
  // settings publication invalidates all of them plus robots.txt. The contract
  // owns that fan-out; this route only records what it decided.
  const delivery = decidePublication(siteSettingsPublishEvent(revisionId));
  if (!delivery.ok) return redirectError(request, "publish_rejected");

  const eventId = crypto.randomUUID();
  const createdAt = recordTimestamp();
  try {
    await db.batch([
      db.insert(siteSettingsPublicationEvents).values({ id: eventId, requestKey, revisionId, note, createdBy: actor.userId, createdAt }),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "PUBLISH_SITE_SETTINGS", entityType: "site_settings_publication", entityId: eventId, after: { revisionId, note, verifiedReferences: references.imageItemIds.length, invalidation: delivery.invalidation } })),
    ]);
  } catch {
    const concurrent = await db.select({ id: siteSettingsPublicationEvents.id }).from(siteSettingsPublicationEvents).where(eq(siteSettingsPublicationEvents.requestKey, requestKey)).get();
    if (concurrent) return NextResponse.redirect(new URL("/app/site-settings?status=already_published", request.url), 303);
    return redirectError(request, "publish_failed");
  }
  return NextResponse.redirect(new URL("/app/site-settings?status=published", request.url), 303);
}

function redirectError(request: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`/app/site-settings?error=${encodeURIComponent(code)}`, request.url), 303);
}

function text(value: FormDataEntryValue | null, max: number) {
  return String(value ?? "").trim().slice(0, max);
}
