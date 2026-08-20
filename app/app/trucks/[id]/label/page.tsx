import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { OperationalQrLabel } from "@/components/operational-qr-label";
import { PrintButton } from "@/components/print-button";
import { getDb } from "@/db";
import { trucks } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

const typeLabels = { FOUR_WHEEL: "รถขนส่ง 4 ล้อ", SIX_WHEEL: "รถขนส่ง 6 ล้อ", OTHER: "ประเภทอื่น" } as const;

export default async function TruckLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor(`/app/trucks/${id}/label`);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:write")) notFound();
  const truck = await getDb().select().from(trucks).where(eq(trucks.id, id)).get();
  if (!truck) notFound();

  return <>
    <div className="app-page-head print-hidden"><div><p>SECURE TRUCK LABEL</p><h1>QR รถขนส่ง {truck.code}</h1><span>QR ไม่ฝังทะเบียนหรือข้อมูลเที่ยววิ่ง</span></div><div className="app-page-actions"><Link href="/app/trips">← กลับรถและเที่ยว</Link><PrintButton label="พิมพ์ QR รถ" /></div></div>
    <div className="label-sheet single-label-sheet"><OperationalQrLabel entityType="truck" publicId={truck.publicId} title={truck.code} subtitle={typeLabels[truck.type]} details={[{ label: "ทะเบียน", value: truck.registration ?? "ยังไม่ระบุ" }, { label: "สถานะ", value: truck.status }]} /></div>
  </>;
}
