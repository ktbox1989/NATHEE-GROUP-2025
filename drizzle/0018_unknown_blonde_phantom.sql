-- Opaque operational QR identities. This migration is additive for Job/Yard and
-- canonicalizes the not-yet-Production Truck/Trip identities created by 0007.
ALTER TABLE `transport_jobs` ADD `public_id` text;
--> statement-breakpoint
UPDATE `transport_jobs`
SET `public_id` = 'job_' || lower(hex(randomblob(16)))
WHERE `public_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_transport_jobs_public_id` ON `transport_jobs` (`public_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_transport_jobs_public_id_insert`
BEFORE INSERT ON `transport_jobs`
WHEN NEW.public_id IS NULL
  OR length(NEW.public_id) <> 36
  OR substr(NEW.public_id, 1, 4) <> 'job_'
  OR substr(NEW.public_id, 5) GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'transport job public identity is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_transport_jobs_public_id_immutable`
BEFORE UPDATE OF `public_id` ON `transport_jobs`
WHEN NEW.public_id IS NULL OR NEW.public_id <> OLD.public_id
BEGIN
  SELECT RAISE(ABORT, 'transport job public identity is immutable');
END;
--> statement-breakpoint

ALTER TABLE `yard_zones` ADD `public_id` text;
--> statement-breakpoint
UPDATE `yard_zones`
SET `public_id` = 'yard_' || lower(hex(randomblob(16)))
WHERE `public_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_yard_zones_public_id` ON `yard_zones` (`public_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_yard_zones_public_id_insert`
BEFORE INSERT ON `yard_zones`
WHEN NEW.public_id IS NULL
  OR length(NEW.public_id) <> 37
  OR substr(NEW.public_id, 1, 5) <> 'yard_'
  OR substr(NEW.public_id, 6) GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'yard public identity is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_yard_zones_public_id_immutable`
BEFORE UPDATE OF `public_id` ON `yard_zones`
WHEN NEW.public_id IS NULL OR NEW.public_id <> OLD.public_id
BEGIN
  SELECT RAISE(ABORT, 'yard public identity is immutable');
END;
--> statement-breakpoint

UPDATE `trucks`
SET `public_id` = 'truck_' || lower(hex(randomblob(16)))
WHERE length(`public_id`) <> 38
   OR substr(`public_id`, 1, 6) <> 'truck_'
   OR substr(`public_id`, 7) GLOB '*[^0-9a-f]*';
--> statement-breakpoint
CREATE TRIGGER `trg_trucks_public_id_insert`
BEFORE INSERT ON `trucks`
WHEN length(NEW.public_id) <> 38
  OR substr(NEW.public_id, 1, 6) <> 'truck_'
  OR substr(NEW.public_id, 7) GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'truck public identity is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_trucks_public_id_immutable`
BEFORE UPDATE OF `public_id` ON `trucks`
WHEN NEW.public_id <> OLD.public_id
BEGIN
  SELECT RAISE(ABORT, 'truck public identity is immutable');
END;
--> statement-breakpoint

UPDATE `trips`
SET `public_id` = 'trip_' || lower(hex(randomblob(16)))
WHERE length(`public_id`) <> 37
   OR substr(`public_id`, 1, 5) <> 'trip_'
   OR substr(`public_id`, 6) GLOB '*[^0-9a-f]*';
--> statement-breakpoint
CREATE TRIGGER `trg_trips_public_id_insert`
BEFORE INSERT ON `trips`
WHEN length(NEW.public_id) <> 37
  OR substr(NEW.public_id, 1, 5) <> 'trip_'
  OR substr(NEW.public_id, 6) GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'trip public identity is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_trips_public_id_immutable`
BEFORE UPDATE OF `public_id` ON `trips`
WHEN NEW.public_id <> OLD.public_id
BEGIN
  SELECT RAISE(ABORT, 'trip public identity is immutable');
END;
