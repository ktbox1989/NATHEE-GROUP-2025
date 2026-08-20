CREATE TABLE `trip_motorcycle_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`trip_id` text NOT NULL,
	`motorcycle_id` text NOT NULL,
	`company_id` text NOT NULL,
	`state` text DEFAULT 'ASSIGNED' NOT NULL,
	`assigned_by` text NOT NULL,
	`assigned_at` text NOT NULL,
	`loaded_at` text,
	`unloaded_at` text,
	`released_at` text,
	`release_reason` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`motorcycle_id`) REFERENCES `motorcycles`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_trip_assignments_state" CHECK("trip_motorcycle_assignments"."state" IN ('ASSIGNED', 'LOADED', 'UNLOADED', 'RELEASED')),
	CONSTRAINT "ck_trip_assignments_release" CHECK(("trip_motorcycle_assignments"."state" = 'RELEASED') = ("trip_motorcycle_assignments"."released_at" IS NOT NULL)),
	CONSTRAINT "ck_trip_assignments_loaded" CHECK("trip_motorcycle_assignments"."state" NOT IN ('LOADED', 'UNLOADED') OR "trip_motorcycle_assignments"."loaded_at" IS NOT NULL),
	CONSTRAINT "ck_trip_assignments_unloaded" CHECK("trip_motorcycle_assignments"."state" <> 'UNLOADED' OR "trip_motorcycle_assignments"."unloaded_at" IS NOT NULL),
	CONSTRAINT "ck_trip_assignments_time_order" CHECK("trip_motorcycle_assignments"."loaded_at" IS NULL OR "trip_motorcycle_assignments"."loaded_at" >= "trip_motorcycle_assignments"."assigned_at"),
	CONSTRAINT "ck_trip_assignments_unload_order" CHECK("trip_motorcycle_assignments"."unloaded_at" IS NULL OR ("trip_motorcycle_assignments"."loaded_at" IS NOT NULL AND "trip_motorcycle_assignments"."unloaded_at" >= "trip_motorcycle_assignments"."loaded_at")),
	CONSTRAINT "ck_trip_assignments_release_reason" CHECK("trip_motorcycle_assignments"."state" <> 'RELEASED' OR length("trip_motorcycle_assignments"."release_reason") BETWEEN 3 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trip_assignments_request_key` ON `trip_motorcycle_assignments` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trip_assignments_motorcycle_active` ON `trip_motorcycle_assignments` (`motorcycle_id`) WHERE "trip_motorcycle_assignments"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_trip_assignments_trip_state` ON `trip_motorcycle_assignments` (`trip_id`,`state`,`assigned_at`);--> statement-breakpoint
CREATE INDEX `idx_trip_assignments_company_active` ON `trip_motorcycle_assignments` (`company_id`,`assigned_at`) WHERE "trip_motorcycle_assignments"."released_at" IS NULL;--> statement-breakpoint
CREATE TRIGGER `trg_trip_assignments_validate_insert`
BEFORE INSERT ON `trip_motorcycle_assignments`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM `trips`
	WHERE `id` = NEW.`trip_id` AND `status` IN ('DRAFT', 'PLANNED')
)
OR NOT EXISTS (
	SELECT 1 FROM `motorcycles`
	WHERE `id` = NEW.`motorcycle_id`
	AND `company_id` = NEW.`company_id`
	AND `current_status` = 'SCHEDULED'
)
OR EXISTS (
	SELECT 1
	FROM `trips` t
	JOIN `trucks` truck ON truck.`id` = t.`truck_id`
	WHERE t.`id` = NEW.`trip_id`
	AND (
		SELECT COUNT(*) FROM `trip_motorcycle_assignments` active_assignment
		WHERE active_assignment.`trip_id` = NEW.`trip_id`
		AND active_assignment.`released_at` IS NULL
	) >= COALESCE(truck.`capacity_motorcycles`, 1000)
)
BEGIN
	SELECT RAISE(ABORT, 'trip assignment requires an assignable trip, scheduled motorcycle, matching company and available capacity');
END;--> statement-breakpoint
CREATE TRIGGER `trg_trip_assignments_identity_immutable`
BEFORE UPDATE OF `request_key`, `trip_id`, `motorcycle_id`, `company_id`, `assigned_by`, `assigned_at`
ON `trip_motorcycle_assignments`
FOR EACH ROW
WHEN NEW.`request_key` <> OLD.`request_key`
OR NEW.`trip_id` <> OLD.`trip_id`
OR NEW.`motorcycle_id` <> OLD.`motorcycle_id`
OR NEW.`company_id` <> OLD.`company_id`
OR NEW.`assigned_by` <> OLD.`assigned_by`
OR NEW.`assigned_at` <> OLD.`assigned_at`
BEGIN
	SELECT RAISE(ABORT, 'trip assignment identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `trg_trip_assignments_validate_state`
BEFORE UPDATE OF `state` ON `trip_motorcycle_assignments`
FOR EACH ROW
WHEN NOT (
	(OLD.`state` = 'ASSIGNED' AND NEW.`state` IN ('LOADED', 'RELEASED'))
	OR (OLD.`state` = 'LOADED' AND NEW.`state` = 'UNLOADED')
	OR (OLD.`state` = 'UNLOADED' AND NEW.`state` = 'RELEASED')
)
OR (
	NEW.`state` = 'LOADED'
	AND NOT EXISTS (
		SELECT 1 FROM `motorcycles`
		WHERE `id` = OLD.`motorcycle_id` AND `current_status` IN ('LOADED', 'IN_TRANSIT')
	)
)
OR (
	NEW.`state` = 'LOADED'
	AND NOT EXISTS (
		SELECT 1 FROM `trips` WHERE `id` = OLD.`trip_id` AND `status` = 'LOADING'
	)
)
OR (
	NEW.`state` = 'UNLOADED'
	AND NOT EXISTS (
		SELECT 1 FROM `motorcycles`
		WHERE `id` = OLD.`motorcycle_id` AND `current_status` IN ('ARRIVED', 'DELIVERED', 'CLOSED')
	)
)
OR (
	NEW.`state` = 'UNLOADED'
	AND NOT EXISTS (
		SELECT 1 FROM `trips` WHERE `id` = OLD.`trip_id` AND `status` = 'ARRIVED'
	)
)
OR (
	NEW.`state` = 'RELEASED'
	AND NOT EXISTS (
		SELECT 1 FROM `trips`
		WHERE `id` = OLD.`trip_id`
		AND (
			(OLD.`state` = 'ASSIGNED' AND `status` IN ('DRAFT', 'PLANNED', 'CANCELLED'))
			OR (OLD.`state` = 'UNLOADED' AND `status` = 'COMPLETED')
		)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'trip assignment state is incompatible with motorcycle workflow');
END;--> statement-breakpoint
CREATE TRIGGER `trg_trip_assignments_no_delete`
BEFORE DELETE ON `trip_motorcycle_assignments`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'trip assignment history cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `trg_trips_validate_status_transition`
BEFORE UPDATE OF `status` ON `trips`
FOR EACH ROW
WHEN NOT (
	(OLD.`status` = 'DRAFT' AND NEW.`status` IN ('PLANNED', 'CANCELLED'))
	OR (OLD.`status` = 'PLANNED' AND NEW.`status` IN ('LOADING', 'CANCELLED'))
	OR (OLD.`status` = 'LOADING' AND NEW.`status` IN ('IN_TRANSIT', 'CANCELLED'))
	OR (OLD.`status` = 'IN_TRANSIT' AND NEW.`status` = 'ARRIVED')
	OR (OLD.`status` = 'ARRIVED' AND NEW.`status` = 'COMPLETED')
)
OR (
	NEW.`status` = 'LOADING'
	AND NOT EXISTS (
		SELECT 1 FROM `trip_motorcycle_assignments`
		WHERE `trip_id` = NEW.`id` AND `released_at` IS NULL
	)
)
OR (
	NEW.`status` = 'IN_TRANSIT'
	AND (
		NOT EXISTS (
			SELECT 1 FROM `trip_motorcycle_assignments`
			WHERE `trip_id` = NEW.`id` AND `released_at` IS NULL
		)
		OR EXISTS (
			SELECT 1
			FROM `trip_motorcycle_assignments` assignment
			JOIN `motorcycles` motorcycle ON motorcycle.`id` = assignment.`motorcycle_id`
			WHERE assignment.`trip_id` = NEW.`id`
			AND assignment.`released_at` IS NULL
			AND (assignment.`state` <> 'LOADED' OR motorcycle.`current_status` <> 'IN_TRANSIT')
		)
	)
)
OR (
	NEW.`status` = 'ARRIVED'
	AND (
		NOT EXISTS (
			SELECT 1 FROM `trip_motorcycle_assignments`
			WHERE `trip_id` = NEW.`id` AND `released_at` IS NULL
		)
		OR EXISTS (
			SELECT 1
			FROM `trip_motorcycle_assignments` assignment
			JOIN `motorcycles` motorcycle ON motorcycle.`id` = assignment.`motorcycle_id`
			WHERE assignment.`trip_id` = NEW.`id`
			AND assignment.`released_at` IS NULL
			AND (assignment.`state` <> 'LOADED' OR motorcycle.`current_status` NOT IN ('ARRIVED', 'DELIVERED', 'CLOSED'))
		)
	)
)
OR (
	NEW.`status` = 'COMPLETED'
	AND (
		NOT EXISTS (
			SELECT 1 FROM `trip_motorcycle_assignments`
			WHERE `trip_id` = NEW.`id` AND `released_at` IS NULL
		)
		OR EXISTS (
			SELECT 1
			FROM `trip_motorcycle_assignments` assignment
			JOIN `motorcycles` motorcycle ON motorcycle.`id` = assignment.`motorcycle_id`
			WHERE assignment.`trip_id` = NEW.`id`
			AND assignment.`released_at` IS NULL
			AND (assignment.`state` <> 'UNLOADED' OR motorcycle.`current_status` NOT IN ('DELIVERED', 'CLOSED'))
		)
	)
)
OR (
	NEW.`status` = 'CANCELLED'
	AND EXISTS (
		SELECT 1 FROM `trip_motorcycle_assignments`
		WHERE `trip_id` = NEW.`id` AND `released_at` IS NULL AND `state` <> 'ASSIGNED'
	)
)
BEGIN
	SELECT RAISE(ABORT, 'trip status is incompatible with assigned motorcycle readiness');
END;
