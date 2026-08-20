import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsPublicPage } from "@/components/cms-public-page";
import { QuotationForm } from "@/components/quotation-form";
import { getManagedPageContent, getManagedPageMetadata } from "@/lib/cms-public-route";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return getManagedPageMetadata("quotation"); }
type Props = { searchParams: Promise<{ submitted?: string; error?: string }> };
export default async function QuotationPage({ searchParams }: Props) {
  const content = await getManagedPageContent("quotation");
  if (!content) notFound();
  const params = await searchParams;
  const requestNumber = /^QT-\d{4}-\d{6}$/.test(params.submitted ?? "") ? params.submitted : "";
  const errorMessage = params.error === "consent" ? "กรุณายืนยันความยินยอมก่อนส่งข้อมูล" : params.error ? "ยังบันทึกคำขอไม่ได้ กรุณาตรวจข้อมูลและลองอีกครั้ง หรือติดต่อทางโทรศัพท์" : "";
  return <CmsPublicPage content={content} slug="quotation" afterContent={<>{requestNumber && <section className="cms-section quotation-result"><div className="shell app-panel"><span className="eyebrow">บันทึกสำเร็จ</span><h2>ได้รับคำขอของคุณแล้ว</h2><p>เลขอ้างอิง <strong>{requestNumber}</strong> กรุณาเก็บหมายเลขนี้ไว้เมื่อติดต่อทีมงาน</p></div></section>}{errorMessage && <section className="cms-section quotation-result"><div className="shell app-panel form-error" role="alert"><h2>ส่งคำขอไม่สำเร็จ</h2><p>{errorMessage}</p></div></section>}<QuotationForm /></>} />;
}
