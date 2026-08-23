CREATE TRIGGER `trg_yard_placements_zone_active`
BEFORE INSERT ON `yard_placements`
WHEN NEW.`exited_at` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `yard_zones` z
    WHERE z.`id` = NEW.`yard_zone_id` AND z.`status` = 'ACTIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'a motorcycle cannot be parked in a zone that is not active');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_yard_placements_zone_capacity`
BEFORE INSERT ON `yard_placements`
WHEN NEW.`exited_at` IS NULL
  AND (SELECT z.`capacity` FROM `yard_zones` z WHERE z.`id` = NEW.`yard_zone_id`) IS NOT NULL
  AND (
    SELECT COUNT(*) FROM `yard_placements` active
    WHERE active.`yard_zone_id` = NEW.`yard_zone_id` AND active.`exited_at` IS NULL
  ) >= (SELECT z.`capacity` FROM `yard_zones` z WHERE z.`id` = NEW.`yard_zone_id`)
BEGIN
  SELECT RAISE(ABORT, 'yard zone is already at capacity');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_yard_placements_company_scope`
BEFORE INSERT ON `yard_placements`
WHEN NEW.`company_id` <> (
    SELECT m.`company_id` FROM `motorcycles` m WHERE m.`id` = NEW.`motorcycle_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'a yard placement must record the company that owns the motorcycle');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_yard_placements_history_immutable`
BEFORE UPDATE ON `yard_placements`
WHEN OLD.`motorcycle_id` <> NEW.`motorcycle_id`
  OR OLD.`company_id` <> NEW.`company_id`
  OR OLD.`yard_zone_id` <> NEW.`yard_zone_id`
  OR OLD.`entered_at` <> NEW.`entered_at`
  OR OLD.`request_key` <> NEW.`request_key`
BEGIN
  SELECT RAISE(ABORT, 'a yard placement records where a motorcycle was; only its exit may be set');
END;
