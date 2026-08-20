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
