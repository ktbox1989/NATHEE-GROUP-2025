import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { sitePagePublicationEvents, sitePageRevisions, sitePages } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { SITE_PAGE_DEFINITIONS, type SitePageSlug } from "@/lib/site-cms";

export const dynamic = "force-dynamic";

export default async function SiteContentPage() {
  const actor = await requireActor("/app/site-content");
  if (!can(actor, "site:read")) redirect("/app");
  const db = getDb();
  const rows = await Promise.all(Object.entries(SITE_PAGE_DEFINITIONS).map(async ([slug, definition]) => {
    const page = await db.select({ id: sitePages.id, updatedAt: sitePages.updatedAt }).from(sitePages).where(eq(sitePages.slug, slug)).get();
    if (!page) return { slug: slug as SitePageSlug, definition, updatedAt: null, revisionCount: 0, state: "UNMANAGED" };
    const [latestEvent, revisions] = await Promise.all([
      db.select({ action: sitePagePublicationEvents.action, createdAt: sitePagePublicationEvents.createdAt }).from(sitePagePublicationEvents).where(eq(sitePagePublicationEvents.pageId, page.id)).orderBy(desc(sitePagePublicationEvents.createdAt), desc(sitePagePublicationEvents.id)).limit(1).get(),
      db.select({ id: sitePageRevisions.id }).from(sitePageRevisions).where(eq(sitePageRevisions.pageId, page.id)).limit(100).all(),
    ]);
    return { slug: slug as SitePageSlug, definition, updatedAt: page.updatedAt, revisionCount: revisions.length, state: latestEvent?.action ?? "DRAFT" };
  }));
  return <><div className="app-page-head"><div><p>WEBSITE CMS</p><h1>จัดการหน้าเว็บไซต์</h1><span>แก้ไขแบบ Revision ก่อนเผยแพร่ ไม่มีการเขียน HTML หรือสคริปต์ลงหน้าเว็บโดยตรง</span></div><Link className="button button-glass" href="/app/site-settings">ตั้งค่าโลโก้ เมนู และ Footer</Link></div><section className="site-page-grid">{rows.map((row) => <article className="app-panel" key={row.slug}><span className={`status-pill ${row.state}`}>{row.state}</span><h2>{row.definition.label}</h2><p>{row.definition.path}</p><small>{row.revisionCount ? `${row.revisionCount}${row.revisionCount >= 100 ? "+" : ""} revisions` : "ยังไม่เคยแก้ผ่าน CMS"}{row.updatedAt ? ` · อัปเดต ${new Date(row.updatedAt).toLocaleString("th-TH")}` : ""}</small><div><Link className="button button-gradient" href={`/app/site-content/${row.slug}`}>แก้ไขหน้า</Link><Link className="button button-glass" href={row.definition.path}>เปิดหน้าเว็บ</Link></div></article>)}</section><section className="app-panel cms-safety-note"><h2>รูปและผลงาน</h2><p>รูปทั้งหมดจัดการผ่าน Media Library เพื่อคงหมวดหมู่ Alt text ลำดับ ภาพเด่น และสถานะเผยแพร่</p><Link className="button button-glass" href="/app/gallery">เปิด Media Library</Link></section><section className="app-panel cms-safety-note"><h2>ขอบเขตความปลอดภัย</h2><p>หน้าเว็บรับเฉพาะ Section ที่ระบบรองรับ เนื้อหาถูก escape อัตโนมัติ ภาพต้องมาจาก Gallery ที่เผยแพร่แล้ว และทุกการบันทึก/เผยแพร่มี Audit กับประวัติย้อนกลับ</p></section></>;
}
