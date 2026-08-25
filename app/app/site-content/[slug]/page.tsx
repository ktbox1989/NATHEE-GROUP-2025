import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { PublishForm } from "@/components/publish-form";
import { SitePageEditor } from "@/components/site-page-editor";
import { getDb } from "@/db";
import { galleryCategories, galleryItems, sitePagePublicationEvents, sitePageRevisions, sitePages, users } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { DEFAULT_SITE_CONTENT, isSitePageSlug, parseCmsPageContentJson, SITE_PAGE_DEFINITIONS } from "@/lib/site-cms";
import { cmsErrorMessage } from "@/lib/site-cms-messages";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string; error?: string; revision?: string; missing?: string }> };

export default async function SitePageEdit({ params, searchParams }: Props) {
  const actor = await requireActor("/app/site-content");
  if (!can(actor, "site:read")) redirect("/app");
  const { slug } = await params;
  if (!isSitePageSlug(slug)) notFound();
  const query = await searchParams;
  const db = getDb();
  const page = await db.select().from(sitePages).where(eq(sitePages.slug, slug)).get();
  const revisions = page ? await db.select({ id: sitePageRevisions.id, contentJson: sitePageRevisions.contentJson, contentHash: sitePageRevisions.contentHash, changeNote: sitePageRevisions.changeNote, createdAt: sitePageRevisions.createdAt, author: users.displayName }).from(sitePageRevisions).innerJoin(users, eq(users.id, sitePageRevisions.createdBy)).where(eq(sitePageRevisions.pageId, page.id)).orderBy(desc(sitePageRevisions.createdAt), desc(sitePageRevisions.id)).limit(20).all() : [];
  const publication = page ? await db.select({ action: sitePagePublicationEvents.action, revisionId: sitePagePublicationEvents.revisionId, createdAt: sitePagePublicationEvents.createdAt }).from(sitePagePublicationEvents).where(eq(sitePagePublicationEvents.pageId, page.id)).orderBy(desc(sitePagePublicationEvents.createdAt), desc(sitePagePublicationEvents.id)).limit(1).get() : null;
  const selected = query.revision ? revisions.find((revision) => revision.id === query.revision) : revisions[0];
  const initial = selected ? parseCmsPageContentJson(selected.contentJson) ?? DEFAULT_SITE_CONTENT[slug] : DEFAULT_SITE_CONTENT[slug];
  const [mediaRows, categoryRows] = await Promise.all([
    db.select({ id: galleryItems.id, title: galleryItems.title }).from(galleryItems).where(and(eq(galleryItems.status, "PUBLISHED"), eq(galleryItems.visibility, "PUBLIC"))).orderBy(desc(galleryItems.isFeatured), desc(galleryItems.createdAt)).limit(200).all(),
    db.select({ slug: galleryCategories.slug, name: galleryCategories.name }).from(galleryCategories).where(eq(galleryCategories.status, "ACTIVE")).orderBy(galleryCategories.sortOrder, galleryCategories.name).limit(100).all(),
  ]);
  const canWrite = can(actor, "site:write");
  const canPublish = can(actor, "site:publish");
  return <><div className="app-page-head"><div><p>WEBSITE CMS</p><h1>{SITE_PAGE_DEFINITIONS[slug].label}</h1><span>{SITE_PAGE_DEFINITIONS[slug].path} · บันทึก Revision ก่อน แล้วจึงเลือกเผยแพร่</span></div><Link className="button button-glass" href="/app/site-content">← ทุกหน้า</Link></div>{query.status && <div className="form-message success page-message">ดำเนินการสำเร็จ: {query.status}</div>}{query.error && <div className="form-message error page-message">{cmsErrorMessage(query.error, query.missing)}</div>}
    <section className="app-panel cms-publication-panel"><div><span className={`status-pill ${publication?.action ?? "DRAFT"}`}>{publication?.action ?? "DRAFT"}</span><h2>สถานะเผยแพร่</h2><p>{publication?.action === "PUBLISH" ? `เผยแพร่ Revision ${publication.revisionId?.slice(0, 8)}…` : publication?.action === "HIDE" ? "ซ่อนหน้าเว็บแล้ว" : "ยังใช้หน้า Default ที่มากับระบบ"}</p></div><div>{selected && <Link className="button button-glass" href={`/app/site-content/${slug}/preview?revision=${encodeURIComponent(selected.id)}`}>ดูตัวอย่าง Revision</Link>}{canPublish && selected && publication?.revisionId !== selected.id && <PublishForm action={`/api/site-content/${slug}/publish`} fields={{ action: "PUBLISH", revisionId: selected.id, requestKey: `cms-publish-${crypto.randomUUID()}` }} label="เผยแพร่ Revision นี้" busyLabel="กำลังเผยแพร่…" />}{canPublish && slug !== "home" && publication?.action === "PUBLISH" && <PublishForm action={`/api/site-content/${slug}/publish`} fields={{ action: "HIDE", revisionId: "", requestKey: `cms-publish-${crypto.randomUUID()}` }} label="ซ่อนหน้านี้" busyLabel="กำลังซ่อน…" confirm={`ซ่อนหน้า “${SITE_PAGE_DEFINITIONS[slug].label}” ใช่หรือไม่? ผู้เข้าชมจะเปิดหน้านี้ไม่ได้จนกว่าจะเผยแพร่อีกครั้ง เนื้อหาและประวัติยังอยู่ครบ`} />}</div></section>
    {canWrite ? <SitePageEditor slug={slug} initial={initial} media={mediaRows.map((item) => ({ id: item.id, label: item.title }))} categories={categoryRows.map((item) => ({ slug: item.slug, label: item.name }))} /> : <div className="app-panel app-empty"><h2>ดูได้อย่างเดียว</h2><p>บัญชีนี้ไม่มีสิทธิ์แก้ไขเนื้อหาเว็บไซต์</p></div>}
    <section className="detail-section"><div className="detail-section-head"><div><p>REVISION HISTORY</p><h2>ประวัติย้อนหลัง</h2></div><span>แสดงล่าสุด {revisions.length} รายการ</span></div><div className="cms-revision-list">{revisions.map((revision) => <article className="app-panel" key={revision.id}><div><b>{revision.id.slice(0, 8)}…</b>{publication?.revisionId === revision.id && publication.action === "PUBLISH" && <span className="status-pill PUBLISH">LIVE</span>}</div><p>{revision.changeNote || "ไม่มีหมายเหตุ"}</p><small>{revision.author} · {new Date(revision.createdAt).toLocaleString("th-TH")} · SHA {revision.contentHash.slice(0, 12)}…</small><div><Link href={`/app/site-content/${slug}?revision=${encodeURIComponent(revision.id)}`}>เปิดแก้จาก Revision นี้</Link><Link href={`/app/site-content/${slug}/preview?revision=${encodeURIComponent(revision.id)}`}>ดูตัวอย่าง</Link>{canPublish && publication?.revisionId !== revision.id && <PublishForm action={`/api/site-content/${slug}/publish`} fields={{ action: "PUBLISH", revisionId: revision.id, requestKey: `cms-publish-${crypto.randomUUID()}` }} label="ย้อนกลับมาเผยแพร่" busyLabel="กำลังเผยแพร่…" />}</div></article>)}</div>{!revisions.length && <div className="app-panel app-empty"><h2>ยังไม่มี Revision</h2><p>หน้าเว็บยังใช้ค่า Default ที่ตรวจผ่านใน Source</p></div>}</section>
  </>;
}

