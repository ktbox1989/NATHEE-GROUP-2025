import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { OperationalQrLabel } from "@/components/operational-qr-label";
import { PrintButton } from "@/components/print-button";
import { getDb } from "@/db";
import { companies, transportJobs } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

export default async function JobLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor(`/app/jobs/${id}/label`);
  const job = await getDb().select({
    id: transportJobs.id, publicId: transportJobs.publicId, companyId: transportJobs.companyId,
    jobNumber: transportJobs.jobNumber, companyName: companies.displayName,
    origin: transportJobs.origin, destination: transportJobs.destination, status: transportJobs.status,
  }).from(transportJobs).innerJoin(companies, eq(companies.id, transportJobs.companyId)).where(eq(transportJobs.id, id)).get();
  if (!job || !can(actor, "jobs:write", job.companyId)) notFound();

  return <>
    <div className="app-page-head print-hidden"><div><p>SECURE JOB LABEL</p><h1>QR งาน {job.jobNumber}</h1><span>QR มีเฉพาะรหัส opaque และไม่ฝังข้อมูลลูกค้าหรือเส้นทาง</span></div><div className="app-page-actions"><Link href="/app/jobs">← กลับงานขนส่ง</Link><PrintButton label="พิมพ์ QR งาน" /></div></div>
    <div className="label-sheet single-label-sheet"><OperationalQrLabel entityType="job" publicId={job.publicId} title={job.jobNumber} subtitle={job.companyName} details={[{ label: "เส้นทาง", value: `${job.origin} → ${job.destination}` }, { label: "สถานะ", value: job.status }]} /></div>
  </>;
}
