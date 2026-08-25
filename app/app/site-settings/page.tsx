import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PublishForm } from "@/components/publish-form";
import { SiteSettingsEditor } from "@/components/site-settings-editor";
import { getDb } from "@/db";
import { galleryItems, siteSettingsPublicationEvents, siteSettingsRevisions, users } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { buildMediaPickerOptions } from "@/lib/media-picker";
import { resolvePublicMedia } from "@/lib/public-media-store";
import { DEFAULT_SITE_SETTINGS, parseSiteSettingsJson } from "@/lib/site-settings";
import { cmsErrorMessage } from "@/lib/site-cms-messages";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ status?: string; error?: string; revision?: string; missing?: string }> };

export default async function SiteSettingsPage({ searchParams }: Props) {
  const actor = await requireActor("/app/site-settings");
  if (!can(actor, "site:read")) redirect("/app");
  const query = await searchParams;
  const db = getDb();
  const [revisions, publication, mediaRows] = await Promise.all([
    db.select({ id: siteSettingsRevisions.id, settingsJson: siteSettingsRevisions.settingsJson, settingsHash: siteSettingsRevisions.settingsHash, changeNote: siteSettingsRevisions.changeNote, createdAt: siteSettingsRevisions.createdAt, author: users.displayName })
      .from(siteSettingsRevisions).innerJoin(users, eq(users.id, siteSettingsRevisions.createdBy))
      .orderBy(desc(siteSettingsRevisions.createdAt), desc(siteSettingsRevisions.id)).limit(20).all(),
    db.select({ revisionId: siteSettingsPublicationEvents.revisionId, createdAt: siteSettingsPublicationEvents.createdAt })
      .from(siteSettingsPublicationEvents).orderBy(desc(siteSettingsPublicationEvents.createdAt), desc(siteSettingsPublicationEvents.id)).limit(1).get(),
    db.select({ id: galleryItems.id, title: galleryItems.title }).from(galleryItems)
      .where(and(eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC")))
      .orderBy(desc(galleryItems.isFeatured), desc(galleryItems.createdAt)).limit(200).all(),
  ]);
  const selected = query.revision ? revisions.find((revision) => revision.id === query.revision) : revisions[0];
  const initial = selected ? parseSiteSettingsJson(selected.settingsJson) ?? DEFAULT_SITE_SETTINGS : DEFAULT_SITE_SETTINGS;
  // Only media that can actually be served is offered. Resolving here means the
  // picker cannot list an item whose publish would then be refused, and the
  // preview uses the same /assets/media/ source the public site uses rather
  // than the authenticated gallery route.
  const { media: resolvedMedia } = await resolvePublicMedia(db, mediaRows.map((item) => item.id));
  const mediaOptions = buildMediaPickerOptions(
    mediaRows.map((item) => ({ id: item.id, label: item.title })),
    resolvedMedia,
  );
  const canWrite = can(actor, "site:write");
  const canPublish = can(actor, "site:publish");

  return <><div className="app-page-head"><div><p>WEBSITE SETTINGS</p><h1>ตั้งค่าเว็บไซต์ส่วนกลาง</h1><span>ชื่อแบรนด์ โลโก้ เบอร์โทร เมนู และ Footer ใช้ร่วมกันทุกหน้าสาธารณะ</span></div><Link className="button button-glass" href="/app/site-content">จัดการเนื้อหาแต่ละหน้า</Link></div>{query.status && <div className="form-message success page-message">ดำเนินการสำเร็จ: {query.status}</div>}{query.error && <div className="form-message error page-message">{cmsErrorMessage(query.error, query.missing)}</div>}
    <section className="app-panel cms-publication-panel"><div><span className={`status-pill ${publication ? "PUBLISH" : "DRAFT"}`}>{publication ? "PUBLISHED" : "DEFAULT"}</span><h2>ค่าที่ใช้งานอยู่</h2><p>{publication ? `เผยแพร่ Revision ${publication.revisionId.slice(0, 8)}…` : "กำลังใช้ค่า Default ที่ตรวจผ่านใน Source"}</p></div><div>{canPublish && selected && publication?.revisionId !== selected.id && <PublishForm action="/api/site-settings/publish" fields={{ revisionId: selected.id, requestKey: `site-settings-publish-${crypto.randomUUID()}` }} label="เผยแพร่ Revision นี้" busyLabel="กำลังเผยแพร่…" />}</div></section>
    {canWrite && <EditingFrom revisionId={selected?.id ?? null} isLive={Boolean(selected && publication?.revisionId === selected.id)} fallback="เริ่มจากค่า Default ที่มากับระบบ · บันทึกแล้วจะได้ Revision แรกของการตั้งค่า" />}
    {canWrite ? <SiteSettingsEditor initial={initial} media={mediaOptions} /> : <div className="app-panel app-empty"><h2>ดูได้อย่างเดียว</h2><p>บัญชีนี้ไม่มีสิทธิ์แก้ไขการตั้งค่าเว็บไซต์</p></div>}
    <section className="detail-section"><div className="detail-section-head"><div><p>REVISION HISTORY</p><h2>ประวัติย้อนหลัง</h2></div><span>แสดงล่าสุด {revisions.length} รายการ</span></div><div className="cms-revision-list">{revisions.map((revision) => <article className="app-panel" key={revision.id}><div><b>{revision.id.slice(0, 8)}…</b>{publication?.revisionId === revision.id && <span className="status-pill PUBLISH">LIVE</span>}</div><p>{revision.changeNote || "ไม่มีหมายเหตุ"}</p><small>{revision.author} · {new Date(revision.createdAt).toLocaleString("th-TH")} · SHA {revision.settingsHash.slice(0, 12)}…</small><div><Link href={`/app/site-settings?revision=${encodeURIComponent(revision.id)}`}>เปิดแก้จาก Revision นี้</Link>{canPublish && publication?.revisionId !== revision.id && <PublishForm action="/api/site-settings/publish" fields={{ revisionId: revision.id, requestKey: `site-settings-publish-${crypto.randomUUID()}` }} label="ย้อนกลับมาเผยแพร่" busyLabel="กำลังเผยแพร่…" />}</div></article>)}</div>{!revisions.length && <div className="app-panel app-empty"><h2>ยังไม่มี Revision</h2><p>เว็บไซต์ยังใช้ค่าที่ตรวจผ่านใน Source</p></div>}</section>
  </>;
}

/** Which revision is loaded, and whether the public already has it. */
function EditingFrom({ revisionId, isLive, fallback }: { revisionId: string | null; isLive: boolean; fallback: string }) {
  if (!revisionId) return <p className="cms-editing-from">{fallback}</p>;
  return (
    <p className="cms-editing-from">
      กำลังแก้จาก Revision {revisionId.slice(0, 8)}…{" "}
      <b>{isLive ? "ฉบับที่เผยแพร่อยู่ตอนนี้" : "ยังไม่ใช่ฉบับที่เผยแพร่"}</b> · บันทึกแล้วจะได้ Revision ใหม่เสมอ ของเดิมไม่ถูกทับ
    </p>
  );
}
