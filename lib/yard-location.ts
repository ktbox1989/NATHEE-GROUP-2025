import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { motorcycles, yardPlacements, yardRows, yardSlots, yardZones } from "@/db/schema";

/**
 * Where a motorcycle actually is, and how much room a zone actually has.
 *
 * Capacity is derived from slots wherever a zone has been mapped, and read from
 * the manual `capacity` only where it has not. Two sources of truth for "how
 * many fit" is how the number drifts from the yard, so the database refuses a
 * manual capacity on a mapped zone and this reports which one it used.
 */

export const YARD_LOCATION_SEPARATOR = " · ";

/** A stable, human-readable position: zone, row, slot. */
export function formatYardLocation(parts: {
  zoneCode: string;
  rowCode?: string | null;
  slotCode?: string | null;
}): string {
  return [parts.zoneCode, parts.rowCode, parts.slotCode].filter(Boolean).join(YARD_LOCATION_SEPARATOR);
}

export type YardLocation = {
  placementId: string;
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  rowId: string | null;
  rowCode: string | null;
  slotId: string | null;
  slotCode: string | null;
  enteredAt: string;
  /** Zone-only placement in a zone that has since been mapped into slots. */
  exact: boolean;
  label: string;
};

/** Where this motorcycle is right now, or null when it is not in the yard. */
export async function getMotorcycleLocation(motorcycleId: string): Promise<YardLocation | null> {
  const row = await getDb()
    .select({
      placementId: yardPlacements.id,
      enteredAt: yardPlacements.enteredAt,
      zoneId: yardZones.id,
      zoneCode: yardZones.code,
      zoneName: yardZones.name,
      rowId: yardRows.id,
      rowCode: yardRows.code,
      slotId: yardSlots.id,
      slotCode: yardSlots.code,
    })
    .from(yardPlacements)
    .innerJoin(yardZones, eq(yardZones.id, yardPlacements.yardZoneId))
    .leftJoin(yardRows, eq(yardRows.id, yardPlacements.yardRowId))
    .leftJoin(yardSlots, eq(yardSlots.id, yardPlacements.yardSlotId))
    .where(and(eq(yardPlacements.motorcycleId, motorcycleId), isNull(yardPlacements.exitedAt)))
    .get();
  if (!row) return null;

  return {
    ...row,
    exact: row.slotId !== null,
    label: formatYardLocation({ zoneCode: row.zoneCode, rowCode: row.rowCode, slotCode: row.slotCode }),
  };
}

export type ZoneCapacity = {
  zoneId: string;
  /** How the number was decided, so a report never implies more than it knows. */
  source: "SLOTS" | "MANUAL" | "UNLIMITED";
  /** Null only when the zone states no limit and has no slots. */
  total: number | null;
  occupied: number;
  available: number | null;
};

export async function getZoneCapacity(zoneId: string): Promise<ZoneCapacity | null> {
  const db = getDb();
  const zone = await db
    .select({ id: yardZones.id, capacity: yardZones.capacity })
    .from(yardZones)
    .where(eq(yardZones.id, zoneId))
    .get();
  if (!zone) return null;

  const slots = await db
    .select({ total: sql<number>`count(*)` })
    .from(yardSlots)
    .innerJoin(yardRows, eq(yardRows.id, yardSlots.yardRowId))
    .where(and(eq(yardRows.yardZoneId, zoneId), eq(yardSlots.status, "ACTIVE"), eq(yardRows.status, "ACTIVE")))
    .get();

  const occupiedRow = await db
    .select({ occupied: sql<number>`count(*)` })
    .from(yardPlacements)
    .where(and(eq(yardPlacements.yardZoneId, zoneId), isNull(yardPlacements.exitedAt)))
    .get();
  const occupied = Number(occupiedRow?.occupied ?? 0);

  const slotTotal = Number(slots?.total ?? 0);
  if (slotTotal > 0) {
    return { zoneId, source: "SLOTS", total: slotTotal, occupied, available: Math.max(0, slotTotal - occupied) };
  }
  if (zone.capacity === null) {
    return { zoneId, source: "UNLIMITED", total: null, occupied, available: null };
  }
  return { zoneId, source: "MANUAL", total: zone.capacity, occupied, available: Math.max(0, zone.capacity - occupied) };
}

export type SlotView = {
  slotId: string;
  slotCode: string;
  status: "ACTIVE" | "BLOCKED" | "RETIRED";
  occupantMotorcycleId: string | null;
  occupantPublicId: string | null;
};

export type RowView = {
  rowId: string;
  rowCode: string;
  rowName: string | null;
  status: "ACTIVE" | "BLOCKED";
  slots: SlotView[];
};

/** The map of one zone, bounded so a very large yard cannot render unboundedly. */
export async function getZoneMap(zoneId: string, limit = 500): Promise<RowView[]> {
  const db = getDb();
  const rows = await db
    .select({ rowId: yardRows.id, rowCode: yardRows.code, rowName: yardRows.name, status: yardRows.status })
    .from(yardRows)
    .where(eq(yardRows.yardZoneId, zoneId))
    .orderBy(asc(yardRows.sortOrder), asc(yardRows.code))
    .limit(100)
    .all();
  if (rows.length === 0) return [];

  const slots = await db
    .select({
      slotId: yardSlots.id,
      slotCode: yardSlots.code,
      status: yardSlots.status,
      rowId: yardSlots.yardRowId,
      occupantMotorcycleId: yardPlacements.motorcycleId,
      occupantPublicId: motorcycles.publicId,
    })
    .from(yardSlots)
    .innerJoin(yardRows, eq(yardRows.id, yardSlots.yardRowId))
    .leftJoin(
      yardPlacements,
      and(eq(yardPlacements.yardSlotId, yardSlots.id), isNull(yardPlacements.exitedAt)),
    )
    .leftJoin(motorcycles, eq(motorcycles.id, yardPlacements.motorcycleId))
    .where(eq(yardRows.yardZoneId, zoneId))
    .orderBy(asc(yardSlots.sortOrder), asc(yardSlots.code))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    ...row,
    slots: slots
      .filter((slot) => slot.rowId === row.rowId)
      .map((slot) => ({
        slotId: slot.slotId,
        slotCode: slot.slotCode,
        status: slot.status,
        occupantMotorcycleId: slot.occupantMotorcycleId,
        occupantPublicId: slot.occupantPublicId,
      })),
  }));
}

/** History for one motorcycle, newest first: each row is where it was and when. */
export async function getMotorcycleMovements(motorcycleId: string, limit = 50) {
  return getDb()
    .select({
      placementId: yardPlacements.id,
      zoneCode: yardZones.code,
      rowCode: yardRows.code,
      slotCode: yardSlots.code,
      enteredAt: yardPlacements.enteredAt,
      exitedAt: yardPlacements.exitedAt,
      note: yardPlacements.note,
    })
    .from(yardPlacements)
    .innerJoin(yardZones, eq(yardZones.id, yardPlacements.yardZoneId))
    .leftJoin(yardRows, eq(yardRows.id, yardPlacements.yardRowId))
    .leftJoin(yardSlots, eq(yardSlots.id, yardPlacements.yardSlotId))
    .where(eq(yardPlacements.motorcycleId, motorcycleId))
    .orderBy(desc(yardPlacements.enteredAt), desc(yardPlacements.id))
    .limit(limit)
    .all();
}

export type FreeSlot = { slotId: string; zoneId: string; label: string };

/**
 * Bays a motorcycle can actually be put in right now: the slot, its row and its
 * zone all active, and nothing parked there. Bounded, because the picker is a
 * dropdown and a large yard would otherwise render every bay it owns.
 */
export async function listFreeSlots(limit = 300): Promise<FreeSlot[]> {
  const rows = await getDb()
    .select({
      slotId: yardSlots.id,
      slotCode: yardSlots.code,
      rowCode: yardRows.code,
      zoneId: yardZones.id,
      zoneCode: yardZones.code,
    })
    .from(yardSlots)
    .innerJoin(yardRows, eq(yardRows.id, yardSlots.yardRowId))
    .innerJoin(yardZones, eq(yardZones.id, yardRows.yardZoneId))
    .leftJoin(yardPlacements, and(eq(yardPlacements.yardSlotId, yardSlots.id), isNull(yardPlacements.exitedAt)))
    .where(
      and(
        eq(yardSlots.status, "ACTIVE"),
        eq(yardRows.status, "ACTIVE"),
        eq(yardZones.status, "ACTIVE"),
        isNull(yardPlacements.id),
      ),
    )
    .orderBy(asc(yardZones.code), asc(yardRows.sortOrder), asc(yardSlots.sortOrder), asc(yardSlots.code))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    slotId: row.slotId,
    zoneId: row.zoneId,
    label: formatYardLocation({ zoneCode: row.zoneCode, rowCode: row.rowCode, slotCode: row.slotCode }),
  }));
}
