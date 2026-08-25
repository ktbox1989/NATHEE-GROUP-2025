/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- the scoped overflow table must be keyboard-focusable */
import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { POSTS_INDEX_PATH } from "@/lib/public-cms/posts";
import { buildAttentionList, readWebsiteOverview, type SitePageOverview } from "@/lib/website-overview";

export const dynamic = "force-dynamic";

const STATE_LABELS: Record<SitePageOverview["state"], string> = {
  PUBLISHED: "เผยแพร่แล้ว",
  HIDDEN: "ซ่อนอยู่",
  SOURCE_DEFAULT: "ใช้ค่าเริ่มต้นจากระบบ",
};

const STATE_PILL: Record<SitePageOverview["state"], string> = {
  PUBLISHED: "PUBLISH",
  HIDDEN: "HIDE",
  SOURCE_DEFAULT: "DRAFT",
};

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString("th-TH") : "—";
}

export default async function WebsiteOverviewPage() {
  const actor = await requireActor("/app/website");
  if (!can(actor, "site:read")) redirect("/app");
  const overview = await readWebsiteOverview();
  const attention = buildAttentionList(overview);
  const canReadGallery = can(actor, "gallery:read");
  const published = overview.pages.filter((page) => page.state === "PUBLISHED").length;

  return (
    <>
      <div className="app-page-head">
        <div>
          <p>WEBSITE CMS</p>
          <h1>จัดการเว็บไซต์</h1>
          <span>ภาพรวมสิ่งที่ผู้เข้าชมเห็นอยู่ตอนนี้ ทุกตัวเลขนับจากฐานข้อมูลจริง</span>
        </div>
        <Link className="button button-glass" href="/" target="_blank" rel="noreferrer">
          เปิดเว็บไซต์สาธารณะ
        </Link>
      </div>

      {overview.unavailable && (
        <div className="form-message error page-message" role="status">
          ตอนนี้อ่านฐานข้อมูลเนื้อหาไม่ได้ จึงยังบอกไม่ได้ว่าอะไรเผยแพร่อยู่ — ตัวเลขด้านล่างจึงยังไม่ใช่ข้อมูลจริง
          กรุณาลองใหม่อีกครั้ง เนื้อหาที่เผยแพร่ไว้ยังอยู่ครบ
        </div>
      )}

      <div className="app-kpis">
        <article>
          <b>{overview.unavailable ? "—" : `${published}/${overview.pages.length}`}</b>
          <span>หน้าเว็บที่เผยแพร่ผ่าน CMS</span>
        </article>
        <article>
          <b>{overview.unavailable ? "—" : overview.posts.published}</b>
          <span>บทความที่เผยแพร่</span>
        </article>
        <article>
          <b>{overview.unavailable ? "—" : overview.media.publicPublished}</b>
          <span>รูปสาธารณะที่เผยแพร่</span>
        </article>
        <article className={!overview.unavailable && (overview.media.drafts > 0 || overview.posts.draft > 0) ? "attention" : ""}>
          <b>{overview.unavailable ? "—" : overview.media.drafts + overview.posts.draft}</b>
          <span>รอตรวจและเผยแพร่</span>
        </article>
      </div>

      <section className="detail-section">
        <div className="detail-section-head">
          <div>
            <p>ต้องดำเนินการ</p>
            <h2>สิ่งที่ควรดูก่อน</h2>
          </div>
          <span>{overview.unavailable ? "ยังตรวจไม่ได้" : `${attention.length} รายการ`}</span>
        </div>
        {overview.unavailable ? (
          <div className="app-panel app-empty">
            <h2>ยังตรวจสอบไม่ได้</h2>
            <p>ระบบเนื้อหาตอบไม่ได้ชั่วคราว จึงยังไม่สามารถบอกได้ว่ามีอะไรค้างอยู่</p>
          </div>
        ) : attention.length === 0 ? (
          <div className="app-panel app-empty">
            <div aria-hidden="true">✓</div>
            <h2>ไม่มีรายการค้าง</h2>
            <p>ทุกหน้าที่เผยแพร่แล้วเปิดดูได้ และไม่มีรูปหรือบทความรอตรวจ</p>
          </div>
        ) : (
          <div className="website-attention-list">
            {attention.map((item) => (
              <Link className="app-panel website-attention-item" href={item.href} key={`${item.href}-${item.label}`}>
                <b>{item.label}</b>
                <span>{item.detail}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="detail-section">
        <div className="detail-section-head">
          <div>
            <p>ส่วนที่จัดการได้</p>
            <h2>เลือกสิ่งที่ต้องการแก้</h2>
          </div>
        </div>
        <div className="site-page-grid">
          <article className="app-panel">
            <h2>หน้าเว็บไซต์</h2>
            <p>ข้อความ หัวข้อ ปุ่ม รูปประกอบ และ SEO ของแต่ละหน้า — รวมถึงเลือกให้ค้นหาเจอหรือไม่ (INDEX / NOINDEX) รายหน้า</p>
            <small>
              {overview.unavailable
                ? "ยังอ่านสถานะไม่ได้"
                : `เผยแพร่ ${published} หน้า · ซ่อน ${overview.pages.filter((page) => page.state === "HIDDEN").length} หน้า · ใช้ค่าเริ่มต้น ${overview.pages.filter((page) => page.state === "SOURCE_DEFAULT").length} หน้า`}
            </small>
            <div>
              <Link className="button button-gradient" href="/app/site-content">เปิดตัวจัดการหน้าเว็บ</Link>
            </div>
          </article>

          <article className="app-panel">
            <h2>ข่าวและบทความ</h2>
            <p>เขียน แก้ไข ดูตัวอย่าง และเผยแพร่บทความที่ {POSTS_INDEX_PATH}</p>
            <small>
              {overview.unavailable
                ? "ยังอ่านสถานะไม่ได้"
                : `ทั้งหมด ${overview.posts.total} · เผยแพร่ ${overview.posts.published} · ยังไม่เผยแพร่ ${overview.posts.draft} · ยกเลิกเผยแพร่ ${overview.posts.hidden}`}
            </small>
            <div>
              <Link className="button button-gradient" href="/app/posts">เปิดตัวจัดการบทความ</Link>
              <Link className="button button-glass" href={POSTS_INDEX_PATH} target="_blank" rel="noreferrer">ดูหน้าข่าวจริง</Link>
            </div>
          </article>

          {canReadGallery && (
            <article className="app-panel">
              <h2>Media Library</h2>
              <p>รูปผลงานจริง หมวดหมู่ Alt text ลำดับ ภาพเด่น และสถานะเผยแพร่</p>
              <small>
                {overview.unavailable
                  ? "ยังอ่านสถานะไม่ได้"
                  : `สาธารณะที่เผยแพร่ ${overview.media.publicPublished} · ภาพเด่น ${overview.media.featured} · รอตรวจ ${overview.media.drafts} · ไม่ใช่สื่อสาธารณะ ${overview.media.notPublic}`}
              </small>
              <div>
                <Link className="button button-gradient" href="/app/gallery">เปิด Media Library</Link>
                <Link className="button button-glass" href="/app/gallery/order">จัดลำดับที่แสดงบนเว็บ</Link>
              </div>
            </article>
          )}

          <article className="app-panel">
            <h2>ตั้งค่าเว็บไซต์ส่วนกลาง</h2>
            <p>ชื่อแบรนด์ โลโก้ เมนู Footer และข้อมูลติดต่อ — เบอร์โทร อีเมล ที่อยู่ LINE ID และ QR Code ที่ใช้ร่วมกันทุกหน้า</p>
            <small>
              {overview.unavailable
                ? "ยังอ่านสถานะไม่ได้"
                : overview.settings.published
                  ? `เผยแพร่แล้ว · แก้ล่าสุด ${when(overview.settings.changedAt)} · ${overview.settings.revisionCount} revisions`
                  : "ยังใช้ค่า Default ที่ตรวจผ่านใน Source"}
            </small>
            <div>
              <Link className="button button-gradient" href="/app/site-settings">เปิดการตั้งค่า</Link>
            </div>
          </article>
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section-head">
          <div>
            <p>สถานะรายหน้า</p>
            <h2>ผู้เข้าชมเห็นอะไรอยู่</h2>
          </div>
          <span>{overview.pages.length} หน้า</span>
        </div>
        <div className="data-table-wrap" tabIndex={0} role="region" aria-label="สถานะการเผยแพร่รายหน้า (เลื่อนแนวนอนได้บนหน้าจอเล็ก)">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">หน้า</th>
                <th scope="col">สถานะ</th>
                <th scope="col">Revisions</th>
                <th scope="col">เปลี่ยนล่าสุด</th>
                <th scope="col">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {overview.pages.map((page) => (
                <tr key={page.slug}>
                  <th scope="row">
                    {page.label}
                    <small>{page.path}</small>
                  </th>
                  <td>
                    <span className={`status-pill ${STATE_PILL[page.state]}`}>{STATE_LABELS[page.state]}</span>
                    {!page.canHide && <small>ซ่อนหน้านี้ไม่ได้ เพื่อให้เว็บไซต์มีหน้าแรกเสมอ</small>}
                  </td>
                  <td>{overview.unavailable ? "—" : page.revisionCount}</td>
                  <td>{overview.unavailable ? "—" : when(page.changedAt)}</td>
                  <td>
                    <Link href={`/app/site-content/${page.slug}`}>แก้ไข</Link>
                    {" · "}
                    <Link href={page.path} target="_blank" rel="noreferrer">เปิดหน้าจริง</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
