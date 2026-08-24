CREATE TABLE `yard_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`yard_zone_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`yard_zone_id`) REFERENCES `yard_zones`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT `ck_yard_rows_code` CHECK (length(`code`) BETWEEN 1 AND 20 AND `code` NOT GLOB '*[^A-Z0-9-]*'),
	CONSTRAINT `ck_yard_rows_status` CHECK (`status` IN ('ACTIVE', 'BLOCKED')),
	CONSTRAINT `ck_yard_rows_sort` CHECK (`sort_order` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_yard_rows_zone_code` ON `yard_rows` (`yard_zone_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_yard_rows_zone_order` ON `yard_rows` (`yard_zone_id`,`sort_order`,`code`);--> statement-breakpoint
CREATE TABLE `yard_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`yard_row_id` text NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`yard_row_id`) REFERENCES `yard_rows`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT `ck_yard_slots_code` CHECK (length(`code`) BETWEEN 1 AND 20 AND `code` NOT GLOB '*[^A-Z0-9-]*'),
	CONSTRAINT `ck_yard_slots_status` CHECK (`status` IN ('ACTIVE', 'BLOCKED', 'RETIRED')),
	CONSTRAINT `ck_yard_slots_sort` CHECK (`sort_order` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_yard_slots_row_code` ON `yard_slots` (`yard_row_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_yard_slots_row_order` ON `yard_slots` (`yard_row_id`,`sort_order`,`code`);--> statement-breakpoint
ALTER TABLE `yard_placements` ADD `yard_row_id` text REFERENCES `yard_rows`(`id`);--> statement-breakpoint
ALTER TABLE `yard_placements` ADD `yard_slot_id` text REFERENCES `yard_slots`(`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_yard_placements_slot_active` ON `yard_placements` (`yard_slot_id`) WHERE `yard_slot_id` IS NOT NULL AND `exited_at` IS NULL;--> statement-breakpoint
CREATE INDEX `idx_yard_placements_slot_entered` ON `yard_placements` (`yard_slot_id`,`entered_at`);--> statement-breakpoint
CREATE TRIGGER `trg_yard_slots_zone_capacity_conflict`
BEFORE INSERT ON `yard_slots`
WHEN (
    SELECT z.`capacity` FROM `yard_zones` z
    JOIN `yard_rows` r ON r.`yard_zone_id` = z.`id`
    WHERE r.`id` = NEW.`yard_row_id`
  ) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'clear the manual capacity on this zone first: with slots, capacity is the number of slots');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_yard_zones_capacity_when_slotted`
BEFORE UPDATE OF `capacity` ON `yard_zones`
WHEN NEW.`capacity` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `yard_rows` r
    JOIN `yard_slots` s ON s.`yard_row_id` = r.`id`
    WHERE r.`yard_zone_id` = NEW.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'this zone has slots, so its capacity is the number of slots and cannot be set by hand');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_yard_placements_slot_belongs_to_zone`
BEFORE INSERT ON `yard_placements`
WHEN NEW.`yard_slot_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `yard_slots` s
    JOIN `yard_rows` r ON r.`id` = s.`yard_row_id`
    WHERE s.`id` = NEW.`yard_slot_id`
      AND r.`yard_zone_id` = NEW.`yard_zone_id`
      AND (NEW.`yard_row_id` IS NULL OR NEW.`yard_row_id` = r.`id`)
  )
BEGIN
  SELECT RAISE(ABORT, 'the slot, its row and the zone must be the same place');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_yard_placements_row_belongs_to_zone`
BEFORE INSERT ON `yard_placements`
WHEN NEW.`yard_row_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `yard_rows` r
    WHERE r.`id` = NEW.`yard_row_id` AND r.`yard_zone_id` = NEW.`yard_zone_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'the slot, its row and the zone must be the same place');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_yard_placements_slot_usable`
BEFORE INSERT ON `yard_placements`
WHEN NEW.`exited_at` IS NULL
  AND NEW.`yard_slot_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `yard_slots` s
    JOIN `yard_rows` r ON r.`id` = s.`yard_row_id`
    WHERE s.`id` = NEW.`yard_slot_id` AND s.`status` = 'ACTIVE' AND r.`status` = 'ACTIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'this slot cannot take a motorcycle');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_yard_placements_require_slot_when_mapped`
BEFORE INSERT ON `yard_placements`
WHEN NEW.`exited_at` IS NULL
  AND NEW.`yard_slot_id` IS NULL
  AND EXISTS (
    SELECT 1 FROM `yard_rows` r
    JOIN `yard_slots` s ON s.`yard_row_id` = r.`id`
    WHERE r.`yard_zone_id` = NEW.`yard_zone_id` AND s.`status` = 'ACTIVE' AND r.`status` = 'ACTIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'this zone is mapped into slots, so the motorcycle needs an exact slot');
END;
--> statement-breakpoint
DROP TRIGGER `trg_yard_placements_zone_capacity`;--> statement-breakpoint
CREATE TRIGGER `trg_yard_placements_zone_capacity`
BEFORE INSERT ON `yard_placements`
WHEN NEW.`exited_at` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `yard_rows` r
    JOIN `yard_slots` s ON s.`yard_row_id` = r.`id`
    WHERE r.`yard_zone_id` = NEW.`yard_zone_id`
  )
  AND (SELECT z.`capacity` FROM `yard_zones` z WHERE z.`id` = NEW.`yard_zone_id`) IS NOT NULL
  AND (
    SELECT COUNT(*) FROM `yard_placements` active
    WHERE active.`yard_zone_id` = NEW.`yard_zone_id` AND active.`exited_at` IS NULL
  ) >= (SELECT z.`capacity` FROM `yard_zones` z WHERE z.`id` = NEW.`yard_zone_id`)
BEGIN
  SELECT RAISE(ABORT, 'yard zone is already at capacity');
END;
--> statement-breakpoint
DROP TRIGGER `trg_yard_placements_history_immutable`;--> statement-breakpoint
CREATE TRIGGER `trg_yard_placements_history_immutable`
BEFORE UPDATE ON `yard_placements`
WHEN OLD.`motorcycle_id` <> NEW.`motorcycle_id`
  OR OLD.`company_id` <> NEW.`company_id`
  OR OLD.`yard_zone_id` <> NEW.`yard_zone_id`
  OR OLD.`entered_at` <> NEW.`entered_at`
  OR OLD.`request_key` <> NEW.`request_key`
  OR COALESCE(OLD.`yard_row_id`, '') <> COALESCE(NEW.`yard_row_id`, '')
  OR COALESCE(OLD.`yard_slot_id`, '') <> COALESCE(NEW.`yard_slot_id`, '')
BEGIN
  SELECT RAISE(ABORT, 'a yard placement records where a motorcycle was; only its exit may be set');
END;
