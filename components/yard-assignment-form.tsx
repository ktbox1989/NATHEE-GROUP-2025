"use client";

import { useMemo, useState } from "react";
import { PendingForm, PendingSubmitButton } from "@/components/pending-form";

type Zone = { id: string; code: string; name: string };
type Row = { rowId: string; rowCode: string; rowName: string | null; zoneId: string };
type Slot = { slotId: string; slotCode: string; rowId: string; rowCode: string; zoneId: string; zoneCode: string; label: string };

export function YardAssignmentForm({
  motorcycleId,
  expectedPlacementId,
  requestKey,
  zones,
  rows,
  slots,
  moving,
}: {
  motorcycleId: string;
  expectedPlacementId: string;
  requestKey: string;
  zones: Zone[];
  rows: Row[];
  slots: Slot[];
  moving: boolean;
}) {
  const [zoneId, setZoneId] = useState("");
  const [rowId, setRowId] = useState("");
  const [slotId, setSlotId] = useState("");
  const zoneRows = useMemo(() => rows.filter((row) => row.zoneId === zoneId), [rows, zoneId]);
  const rowSlots = useMemo(() => slots.filter((slot) => slot.rowId === rowId), [slots, rowId]);
  const selectedZoneIsMapped = zoneRows.length > 0;

  return <PendingForm className="app-panel status-form yard-form" action={`/api/motorcycles/${motorcycleId}/yard`} busyMessage="กำลังตรวจช่องว่างล่าสุดและบันทึกตำแหน่ง…">
    <h2>{moving ? "ย้ายตำแหน่ง" : "นำรถเข้าลาน"}</h2>
    <input type="hidden" name="expectedPlacementId" value={expectedPlacementId} />
    <input type="hidden" name="requestKey" value={requestKey} />
    <div className="field"><label htmlFor="destinationZoneId">โซน / ลานปลายทาง</label><select id="destinationZoneId" name="destinationZoneId" required value={zoneId} onChange={(event) => { setZoneId(event.target.value); setRowId(""); setSlotId(""); }}><option value="">เลือกโซน</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.code} · {zone.name}</option>)}</select></div>
    {selectedZoneIsMapped && <div className="field"><label htmlFor="destinationRowId">แถว</label><select id="destinationRowId" required value={rowId} onChange={(event) => { setRowId(event.target.value); setSlotId(""); }}><option value="">เลือกแถว</option>{zoneRows.map((row) => <option key={row.rowId} value={row.rowId}>{row.rowCode}{row.rowName ? ` · ${row.rowName}` : ""}</option>)}</select></div>}
    {selectedZoneIsMapped && <div className="field"><label htmlFor="destinationSlotId">ช่องจอดว่าง</label><select id="destinationSlotId" name="destinationSlotId" required value={slotId} onChange={(event) => setSlotId(event.target.value)} disabled={!rowId}><option value="">{rowId && rowSlots.length === 0 ? "แถวนี้ไม่มีช่องว่าง" : "เลือกช่อง"}</option>{rowSlots.map((slot) => <option key={slot.slotId} value={slot.slotId}>{slot.slotCode} · {slot.label}</option>)}</select><small>รายการอ่านจาก D1 ล่าสุดตอนเปิดหน้า และ Backend ตรวจซ้ำก่อนบันทึก</small></div>}
    {!selectedZoneIsMapped && zoneId && <p className="yard-selection-note">โซนนี้ยังไม่แบ่งแถว/ช่อง ระบบจะบันทึกตำแหน่งระดับโซนตาม contract เดิม</p>}
    <div className="field"><label htmlFor="yardNote">หมายเหตุ</label><textarea id="yardNote" name="note" rows={2} maxLength={500} /></div>
    <PendingSubmitButton className="button button-gradient" busyLabel="กำลังบันทึกตำแหน่ง…">บันทึกตำแหน่ง</PendingSubmitButton>
  </PendingForm>;
}
