import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsPublicPage } from "@/components/cms-public-page";
import { QuotationForm } from "@/components/quotation-form";
import { getManagedPageContent, getManagedPageMetadata } from "@/lib/cms-public-route";
import { getTurnstileWidgetSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return getManagedPageMetadata("quotation"); }
type Props = { searchParams: Promise<{ submitted?: string; error?: string }> };
export default async function QuotationPage({ searchParams }: Props) {
  const content = await getManagedPageContent("quotation");
  if (!content) notFound();
  const params = await searchParams;
  const requestNumber = /^QT-\d{4}-\d{6}$/.test(params.submitted ?? "") ? params.submitted : "";
  const turnstileSiteKey = getTurnstileWidgetSiteKey();
  const errorMessage = params.error === "consent"
    ? "กรุณายืนยันความยินยอมก่อนส่งข้อมูล"
    : params.error === "challenge"
      ? "ยังยืนยันความปลอดภัยไม่ได้ กรุณารอให้ช่องตรวจสอบพร้อมแล้วลองอีกครั้ง"
    : params.error?.startsWith("file_")
      ? "เอกสารประกอบไม่ผ่านการตรวจ กรุณาใช้ PDF, CSV, Excel หรือรูปภาพไม่เกิน 5 ไฟล์ ไฟล์ละ 8 MB และรวมไม่เกิน 20 MB"
      : params.error
        ? "ยังบันทึกคำขอไม่ได้ กรุณาตรวจข้อมูลและลองอีกครั้ง หรือติดต่อทางโทรศัพท์"
        : "";
  return <CmsPublicPage content={content} slug="quotation" afterContent={<>{requestNumber && <section className="cms-section quotation-result"><div className="shell app-panel"><span className="eyebrow">บันทึกสำเร็จ</span><h2>ได้รับคำขอของคุณแล้ว</h2><p>เลขอ้างอิง <strong>{requestNumber}</strong> กรุณาเก็บหมายเลขนี้ไว้เมื่อติดต่อทีมงาน</p></div></section>}{errorMessage && <section className="cms-section quotation-result"><div className="shell app-panel form-error" role="alert"><h2>ส่งคำขอไม่สำเร็จ</h2><p>{errorMessage}</p></div></section>}{turnstileSiteKey ? <QuotationForm siteKey={turnstileSiteKey} /> : <section className="cms-section quotation-result"><div className="shell app-panel"><span className="eyebrow">ONLINE FORM</span><h2>ระบบออนไลน์ยังไม่เปิดรับคำขอ</h2><p>ระบบปิดแบบปลอดภัยจนกว่าการยืนยันป้องกันสแปมจะพร้อม กรุณาโทร <a href="tel:0631941191">063-194-1191</a> หรือ <a href="tel:0856802082">085-680-2082</a></p></div></section>}</>} />;
}
