export const EXIT_ACTIVE_YARD_PLACEMENT_SQL = `
  UPDATE yard_placements
  SET exited_at = ?
  WHERE id = ? AND motorcycle_id = ? AND exited_at IS NULL
`;

export const CLOSE_ACTIVE_YARD_PLACEMENT_FOR_MOVE_SQL = `
  UPDATE yard_placements
  SET exited_at = ?
  WHERE id = ? AND motorcycle_id = ? AND exited_at IS NULL
    AND EXISTS (
      SELECT 1 FROM yard_zones z
      WHERE z.id = ? AND z.status = 'ACTIVE'
        AND (z.capacity IS NULL OR (
          SELECT COUNT(*) FROM yard_placements active
          WHERE active.yard_zone_id = z.id AND active.exited_at IS NULL
        ) < z.capacity)
    )
`;

export function insertYardPlacementSql(hasCurrentPlacement: boolean): string {
  return `
    INSERT INTO yard_placements
      (id, request_key, motorcycle_id, company_id, yard_zone_id,
       entered_at, exited_at, placed_by, note, created_at)
    SELECT ?, ?, ?, ?, z.id, ?, NULL, ?, ?, CURRENT_TIMESTAMP
    FROM yard_zones z
    WHERE z.id = ? AND z.status = 'ACTIVE'
      AND (z.capacity IS NULL OR (
        SELECT COUNT(*) FROM yard_placements active
        WHERE active.yard_zone_id = z.id AND active.exited_at IS NULL
      ) < z.capacity)
      AND NOT EXISTS (
        SELECT 1 FROM yard_placements active
        WHERE active.motorcycle_id = ? AND active.exited_at IS NULL
      )
      ${hasCurrentPlacement ? "AND EXISTS (SELECT 1 FROM yard_placements old WHERE old.id = ? AND old.exited_at = ?)" : ""}
  `;
}

/**
 * Closing the current placement is conditional on the destination slot being
 * usable and free, so a move to an occupied slot leaves the motorcycle exactly
 * where it was rather than losing track of it.
 */
export const CLOSE_ACTIVE_YARD_PLACEMENT_FOR_SLOT_MOVE_SQL = `
  UPDATE yard_placements
  SET exited_at = ?
  WHERE id = ? AND motorcycle_id = ? AND exited_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM yard_slots s
      JOIN yard_rows r ON r.id = s.yard_row_id
      JOIN yard_zones z ON z.id = r.yard_zone_id
      WHERE s.id = ?
        AND s.status = 'ACTIVE' AND r.status = 'ACTIVE' AND z.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM yard_placements occupied
          WHERE occupied.yard_slot_id = s.id AND occupied.exited_at IS NULL
        )
    )
`;

/**
 * Places a motorcycle in an exact slot.
 *
 * The zone and row are read from the slot rather than passed in, so a caller
 * cannot name a slot in one zone and a zone in another; the pairing is derived,
 * not asserted. Every condition sits in the same statement as the insert, so two
 * scans racing for the last slot cannot both succeed, and the partial unique
 * index on the active slot is the backstop if one ever slips past.
 */
export function insertYardSlotPlacementSql(hasCurrentPlacement: boolean): string {
  return `
    INSERT INTO yard_placements
      (id, request_key, motorcycle_id, company_id, yard_zone_id, yard_row_id, yard_slot_id,
       entered_at, exited_at, placed_by, note, created_at)
    SELECT ?, ?, ?, ?, r.yard_zone_id, r.id, s.id, ?, NULL, ?, ?, CURRENT_TIMESTAMP
    FROM yard_slots s
    JOIN yard_rows r ON r.id = s.yard_row_id
    JOIN yard_zones z ON z.id = r.yard_zone_id
    WHERE s.id = ?
      AND s.status = 'ACTIVE' AND r.status = 'ACTIVE' AND z.status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM yard_placements occupied
        WHERE occupied.yard_slot_id = s.id AND occupied.exited_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM yard_placements active
        WHERE active.motorcycle_id = ? AND active.exited_at IS NULL
      )
      ${hasCurrentPlacement ? "AND EXISTS (SELECT 1 FROM yard_placements old WHERE old.id = ? AND old.exited_at = ?)" : ""}
  `;
}
