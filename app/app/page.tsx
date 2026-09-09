import Link from "next/link";
import { can, isCustomerRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { getDashboardMetrics } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await requireActor("/app");
  const metrics = await getDashboardMetrics(actor);
  const customerRole = isCustomerRole(actor.role);
  const policyCompany = customerRole ? actor.companyId : undefined;
  const canReadJobs = can(actor, "jobs:read", policyCompany);
  const canReadMotorcycles = can(actor, "motorcycles:read", policyCompany);
  const canReadWebsite = can(actor, "site:read");
  const canReadGallery = can(actor, "gallery:read");
  const companyCopy = customerRole
    ? "ภาพรวมงานและรถของบริษัทคุณ"
    : "ภาพรวมการปฏิบัติงานจากข้อมูลจริง";

  return (
    <>
      <div className="app-page-head">
        <div><p>DASHBOARD</p><h1>ภาพรวมระบบ</h1><span>{companyCopy}</span></div>
      </div>
      <div className="app-kpis">
        <article><b>{metrics.jobs}</b><span>งานขนส่ง</span></article>
        <article><b>{metrics.motorcycles}</b><span>รถทั้งหมด</span></article>
        <article><b>{metrics.inYard}</b><span>อยู่ในลาน</span></article>
        <article><b>{metrics.inTransit}</b><span>กำลังขนส่ง</span></article>
        <article><b>{metrics.delivered}</b><span>ส่งมอบ / ปิดงาน</span></article>
        <article className={metrics.issues ? "attention" : ""}>
          <b>{metrics.issues}</b><span>ต้องตรวจสอบ</span>
        </article>
      </div>

      {(canReadWebsite || canReadGallery || canReadJobs) && (
        <section className="detail-section">
          <div className="detail-section-head"><div><p>QUICK ACTIONS</p><h2>จัดการด่วน</h2></div></div>
          <div className="site-page-grid">
            {canReadWebsite && (
              <article className="app-panel">
                <h2>จัดการเว็บไซต์</h2>
                <p>แก้หน้าเว็บ ข่าว บทความ และข้อมูลส่วนกลางโดยไม่ต้องแก้โค้ด</p>
                <div>
                  <Link className="button button-gradient" href="/app/website">เปิด Website CMS</Link>
                  <Link className="button button-glass" href="/app/posts">เพิ่มข่าว / โพสต์</Link>
                </div>
              </article>
            )}
            {canReadGallery && (
              <article className="app-panel">
                <h2>รูปและผลงาน</h2>
                <p>อัปโหลดรูปจริง แก้คำบรรยาย จัดลำดับ และเผยแพร่จากหน้าเว็บ</p>
                <div><Link className="button button-gradient" href="/app/gallery">เปิด Media Library</Link></div>
              </article>
            )}
            {canReadJobs && (
              <article className="app-panel">
                <h2>อัปเดตงานขนส่ง</h2>
                <p>เปิดงาน ดูรถ แก้เส้นทาง/กำหนดการ และอัปเดตสถานะงาน</p>
                <div><Link className="button button-gradient" href="/app/jobs">เปิดงานขนส่ง</Link></div>
              </article>
            )}
          </div>
        </section>
      )}

      <section className="app-panel app-empty">
        <div aria-hidden="true">🛰️</div>
        <h2>{metrics.motorcycles ? "ติดตามรายละเอียดได้จากเมนูรถจักรยานยนต์" : "ยังไม่มีข้อมูลรถในระบบ"}</h2>
        <p>ตัวเลขทั้งหมดคำนวณจากฐานข้อมูล ไม่มีข้อมูลตัวอย่างปะปน</p>
        {(canReadJobs || canReadMotorcycles) && (
          <div className="app-empty-actions">
            {canReadJobs && <Link href="/app/jobs">ดูงานขนส่ง</Link>}
            {canReadMotorcycles && <Link href="/app/motorcycles">ค้นหารถ</Link>}
          </div>
        )}
      </section>
    </>
  );
}
