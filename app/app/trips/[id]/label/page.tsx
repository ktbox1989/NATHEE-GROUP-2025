import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { OperationalQrLabel } from "@/components/operational-qr-label";
import { PrintButton } from "@/components/print-button";
import { getDb } from "@/db";
import { trips, trucks, users } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

export default async function TripLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor(`/app/trips/${id}/label`);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:write")) notFound();
  const trip = await getDb().select({
    id: trips.id, publicId: trips.publicId, tripNumber: trips.tripNumber, origin: trips.origin,
    destination: trips.destination, status: trips.status, truckCode: trucks.code, driverName: users.displayName,
  }).from(trips).innerJoin(trucks, eq(trucks.id, trips.truckId)).leftJoin(users, eq(users.id, trips.driverUserId)).where(eq(trips.id, id)).get();
  if (!trip) notFound();

  return <>
    <div className="app-page-head print-hidden"><div><p>SECURE TRIP LABEL</p><h1>QR เที่ยว {trip.tripNumber}</h1><span>QR มีเพียงรหัสอ้างอิง ระบบตรวจสิทธิ์ก่อนเปิด Load Board</span></div><div className="app-page-actions"><Link href={`/app/trips/${trip.id}`}>← กลับ Load Board</Link><PrintButton label="พิมพ์ QR เที่ยว" /></div></div>
    <div className="label-sheet single-label-sheet"><OperationalQrLabel entityType="trip" publicId={trip.publicId} title={trip.tripNumber} subtitle={`${trip.origin} → ${trip.destination}`} details={[{ label: "รถ", value: trip.truckCode }, { label: "คนขับ", value: trip.driverName ?? "ยังไม่กำหนด" }, { label: "สถานะ", value: trip.status }]} /></div>
  </>;
}
