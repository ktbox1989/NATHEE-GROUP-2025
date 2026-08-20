import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { OperationalQrLabel } from "@/components/operational-qr-label";
import { PrintButton } from "@/components/print-button";
import { getDb } from "@/db";
import { yardPlacements, yardZones } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

export default async function YardLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor(`/app/yard/${id}/label`);
  if (!can(actor, "yard:write")) notFound();
  const zone = await getDb().select({
    id: yardZones.id, publicId: yardZones.publicId, code: yardZones.code, name: yardZones.name,
    capacity: yardZones.capacity, status: yardZones.status, occupied: count(yardPlacements.id),
  }).from(yardZones).leftJoin(yardPlacements, and(eq(yardPlacements.yardZoneId, yardZones.id), isNull(yardPlacements.exitedAt))).where(eq(yardZones.id, id)).groupBy(yardZones.id).get();
  if (!zone) notFound();

  return <>
    <div className="app-page-head print-hidden"><div><p>SECURE YARD LABEL</p><h1>QR โซน {zone.code}</h1><span>ติดที่ป้ายโซนเพื่อเปิดข้อมูลตำแหน่งจริงหลังระบบตรวจสิทธิ์</span></div><div className="app-page-actions"><Link href="/app/yard">← กลับจัดการลาน</Link><PrintButton label="พิมพ์ QR โซน" /></div></div>
    <div className="label-sheet single-label-sheet"><OperationalQrLabel entityType="yard" publicId={zone.publicId} title={`โซน ${zone.code}`} subtitle={zone.name} details={[{ label: "สถานะ", value: zone.status }, { label: "ใช้งาน", value: `${zone.occupied} / ${zone.capacity ?? "ไม่จำกัด"} คัน` }]} /></div>
  </>;
}
