import { redirect } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { can, isCustomerRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { getOperationalReport } from "@/lib/operational-report";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const actor = await requireActor("/app/reports");
  const companyId = isCustomerRole(actor.role) ? actor.companyId : undefined;
  if (!can(actor, "jobs:read", companyId) && !can(actor, "motorcycles:read", companyId)) redirect("/app");
  const sections = await getOperationalReport(actor);
  const renderedAt = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date());

  return <>
    <div className="app-page-head print-hidden"><div><p>OPERATIONAL REPORT</p><h1>รายงานภาพรวม</h1><span>{isCustomerRole(actor.role) ? "เฉพาะข้อมูลบริษัทของคุณ" : "สถานะจริงจากฐานข้อมูล ณ เวลาที่เปิดรายงาน"}</span></div><PrintButton label="พิมพ์ / บันทึก PDF" /></div>
    <main className="report-sheet">
      <header className="document-brand"><div><b>NATHEE GROUP 2025</b><span>OPERATIONAL STATUS REPORT</span></div><small>สร้างเมื่อ {renderedAt}</small></header>
      {sections.length ? <div className="report-grid">{sections.map((item) => <section className="app-panel report-section" key={item.key}>
        <div className="report-section-head"><div><span>{item.key.toUpperCase()}</span><h2>{item.title}</h2></div><strong>{item.total.toLocaleString("th-TH")}</strong></div>
        {item.metrics.length ? <dl>{item.metrics.map((metric) => <div key={metric.status}><dt><span>{metric.label}</span><small>{metric.status}</small></dt><dd>{metric.count.toLocaleString("th-TH")}</dd></div>)}</dl> : <p>ยังไม่มีข้อมูลในหมวดนี้</p>}
      </section>)}</div> : <div className="app-panel app-empty"><div>▥</div><h2>ยังไม่มีข้อมูลที่ได้รับอนุญาต</h2><p>รายงานไม่ใส่ตัวเลขตัวอย่าง เมื่อมีข้อมูลจริงจึงจะแสดงผล</p></div>}
      <footer className="document-footer">รายงานนี้เป็นภาพรวม ณ เวลาที่พิมพ์ กรุณาตรวจรายการต้นฉบับและ Audit Log ก่อนใช้ตัดสินใจ</footer>
    </main>
  </>;
}
