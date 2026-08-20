import Link from "next/link";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { getDashboardMetrics } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await requireActor("/app");
  const metrics = await getDashboardMetrics(actor);
  const policyCompany = actor.role === "CUSTOMER" ? actor.companyId : undefined;
  const canReadJobs = can(actor, "jobs:read", policyCompany);
  const canReadMotorcycles = can(actor, "motorcycles:read", policyCompany);
  const companyCopy =
    actor.role === "CUSTOMER"
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
