CREATE TRIGGER `trg_trips_truck_single_commitment_insert`
BEFORE INSERT ON `trips`
WHEN NEW.`status` IN ('PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED')
  AND EXISTS (
    SELECT 1 FROM `trips` other
    WHERE other.`truck_id` = NEW.`truck_id`
      AND other.`id` <> NEW.`id`
      AND other.`status` IN ('PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED')
  )
BEGIN
  SELECT RAISE(ABORT, 'this truck is already committed to another trip');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_trips_truck_single_commitment_update`
BEFORE UPDATE OF `status`, `truck_id` ON `trips`
WHEN NEW.`status` IN ('PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED')
  AND EXISTS (
    SELECT 1 FROM `trips` other
    WHERE other.`truck_id` = NEW.`truck_id`
      AND other.`id` <> NEW.`id`
      AND other.`status` IN ('PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED')
  )
BEGIN
  SELECT RAISE(ABORT, 'this truck is already committed to another trip');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_trips_driver_single_commitment_insert`
BEFORE INSERT ON `trips`
WHEN NEW.`driver_user_id` IS NOT NULL
  AND NEW.`status` IN ('PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED')
  AND EXISTS (
    SELECT 1 FROM `trips` other
    WHERE other.`driver_user_id` = NEW.`driver_user_id`
      AND other.`id` <> NEW.`id`
      AND other.`status` IN ('PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED')
  )
BEGIN
  SELECT RAISE(ABORT, 'this driver is already committed to another trip');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_trips_driver_single_commitment_update`
BEFORE UPDATE OF `status`, `driver_user_id` ON `trips`
WHEN NEW.`driver_user_id` IS NOT NULL
  AND NEW.`status` IN ('PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED')
  AND EXISTS (
    SELECT 1 FROM `trips` other
    WHERE other.`driver_user_id` = NEW.`driver_user_id`
      AND other.`id` <> NEW.`id`
      AND other.`status` IN ('PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED')
  )
BEGIN
  SELECT RAISE(ABORT, 'this driver is already committed to another trip');
END;
