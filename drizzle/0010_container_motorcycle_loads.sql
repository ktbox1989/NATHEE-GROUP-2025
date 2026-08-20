CREATE TABLE `container_motorcycle_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`container_id` text NOT NULL,
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
	FOREIGN KEY (`container_id`) REFERENCES `shipping_containers`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`motorcycle_id`) REFERENCES `motorcycles`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_container_assignments_state" CHECK("container_motorcycle_assignments"."state" IN ('ASSIGNED', 'LOADED', 'UNLOADED', 'RELEASED')),
	CONSTRAINT "ck_container_assignments_release" CHECK(("container_motorcycle_assignments"."state" = 'RELEASED') = ("container_motorcycle_assignments"."released_at" IS NOT NULL)),
	CONSTRAINT "ck_container_assignments_loaded" CHECK("container_motorcycle_assignments"."state" NOT IN ('LOADED', 'UNLOADED') OR "container_motorcycle_assignments"."loaded_at" IS NOT NULL),
	CONSTRAINT "ck_container_assignments_unloaded" CHECK("container_motorcycle_assignments"."state" <> 'UNLOADED' OR "container_motorcycle_assignments"."unloaded_at" IS NOT NULL),
	CONSTRAINT "ck_container_assignments_time_order" CHECK("container_motorcycle_assignments"."loaded_at" IS NULL OR "container_motorcycle_assignments"."loaded_at" >= "container_motorcycle_assignments"."assigned_at"),
	CONSTRAINT "ck_container_assignments_unload_order" CHECK("container_motorcycle_assignments"."unloaded_at" IS NULL OR ("container_motorcycle_assignments"."loaded_at" IS NOT NULL AND "container_motorcycle_assignments"."unloaded_at" >= "container_motorcycle_assignments"."loaded_at")),
	CONSTRAINT "ck_container_assignments_release_reason" CHECK("container_motorcycle_assignments"."state" <> 'RELEASED' OR length("container_motorcycle_assignments"."release_reason") BETWEEN 3 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_container_assignments_request_key` ON `container_motorcycle_assignments` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_container_assignments_motorcycle_active` ON `container_motorcycle_assignments` (`motorcycle_id`) WHERE "container_motorcycle_assignments"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_container_assignments_container_state` ON `container_motorcycle_assignments` (`container_id`,`state`,`assigned_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_container_assignments_company_active` ON `container_motorcycle_assignments` (`company_id`,`assigned_at`) WHERE "container_motorcycle_assignments"."released_at" IS NULL;--> statement-breakpoint
CREATE TRIGGER `trg_container_assignments_validate_insert`
BEFORE INSERT ON `container_motorcycle_assignments`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM `shipping_containers`
	WHERE `id` = NEW.`container_id` AND `status` IN ('DRAFT', 'PLANNED')
)
OR NOT EXISTS (
	SELECT 1 FROM `motorcycles`
	WHERE `id` = NEW.`motorcycle_id`
	AND `company_id` = NEW.`company_id`
	AND `current_status` = 'SCHEDULED'
)
OR EXISTS (
	SELECT 1 FROM `trip_motorcycle_assignments`
	WHERE `motorcycle_id` = NEW.`motorcycle_id` AND `released_at` IS NULL
)
OR EXISTS (
	SELECT 1 FROM `shipping_containers` container
	WHERE container.`id` = NEW.`container_id`
	AND (
		SELECT COUNT(*) FROM `container_motorcycle_assignments` active_assignment
		WHERE active_assignment.`container_id` = NEW.`container_id`
		AND active_assignment.`released_at` IS NULL
	) >= COALESCE(container.`capacity_motorcycles`, 1000)
)
BEGIN
	SELECT RAISE(ABORT, 'container assignment requires a draft/planned container, scheduled unassigned motorcycle, matching company and available capacity');
END;--> statement-breakpoint
CREATE TRIGGER `trg_trip_assignments_no_active_container`
BEFORE INSERT ON `trip_motorcycle_assignments`
FOR EACH ROW
WHEN EXISTS (
	SELECT 1 FROM `container_motorcycle_assignments`
	WHERE `motorcycle_id` = NEW.`motorcycle_id` AND `released_at` IS NULL
)
BEGIN
	SELECT RAISE(ABORT, 'motorcycle already has an active container assignment');
END;--> statement-breakpoint
CREATE TRIGGER `trg_container_assignments_identity_immutable`
BEFORE UPDATE OF `request_key`, `container_id`, `motorcycle_id`, `company_id`, `assigned_by`, `assigned_at`
ON `container_motorcycle_assignments`
FOR EACH ROW
WHEN NEW.`request_key` <> OLD.`request_key`
OR NEW.`container_id` <> OLD.`container_id`
OR NEW.`motorcycle_id` <> OLD.`motorcycle_id`
OR NEW.`company_id` <> OLD.`company_id`
OR NEW.`assigned_by` <> OLD.`assigned_by`
OR NEW.`assigned_at` <> OLD.`assigned_at`
BEGIN
	SELECT RAISE(ABORT, 'container assignment identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `trg_container_assignments_validate_state`
BEFORE UPDATE OF `state` ON `container_motorcycle_assignments`
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
		WHERE `id` = OLD.`motorcycle_id` AND `current_status` = 'LOADED'
	)
)
OR (
	NEW.`state` = 'LOADED'
	AND NOT EXISTS (
		SELECT 1 FROM `shipping_containers`
		WHERE `id` = OLD.`container_id` AND `status` = 'LOADING'
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
		SELECT 1 FROM `shipping_containers`
		WHERE `id` = OLD.`container_id` AND `status` = 'UNLOADING'
	)
)
OR (
	NEW.`state` = 'RELEASED'
	AND NOT EXISTS (
		SELECT 1 FROM `shipping_containers`
		WHERE `id` = OLD.`container_id`
		AND (
			(OLD.`state` = 'ASSIGNED' AND `status` IN ('DRAFT', 'PLANNED', 'CANCELLED'))
			OR (OLD.`state` = 'UNLOADED' AND `status` = 'COMPLETED')
		)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'container assignment state is incompatible with container and motorcycle workflow');
END;--> statement-breakpoint
CREATE TRIGGER `trg_container_assignments_no_delete`
BEFORE DELETE ON `container_motorcycle_assignments`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'container assignment history cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `trg_container_events_no_update`
BEFORE UPDATE ON `container_status_events`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'container status event history is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `trg_container_events_no_delete`
BEFORE DELETE ON `container_status_events`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'container status event history cannot be deleted');
END;--> statement-breakpoint
DROP TRIGGER `trg_shipping_containers_lifecycle_not_activated`;--> statement-breakpoint
CREATE TRIGGER `trg_shipping_containers_plan_fields_locked`
BEFORE UPDATE OF `type`, `capacity_motorcycles`, `port`, `country` ON `shipping_containers`
FOR EACH ROW
WHEN OLD.`status` <> 'DRAFT'
AND (
	NEW.`type` <> OLD.`type`
	OR NEW.`capacity_motorcycles` IS NOT OLD.`capacity_motorcycles`
	OR NEW.`port` <> OLD.`port`
	OR NEW.`country` <> OLD.`country`
)
BEGIN
	SELECT RAISE(ABORT, 'container plan fields are locked after planning');
END;--> statement-breakpoint
CREATE TRIGGER `trg_shipping_containers_seal_locked`
BEFORE UPDATE OF `seal_number` ON `shipping_containers`
FOR EACH ROW
WHEN OLD.`status` IN ('SEALED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING', 'COMPLETED')
AND NEW.`seal_number` IS NOT OLD.`seal_number`
BEGIN
	SELECT RAISE(ABORT, 'container seal is immutable after sealing');
END;--> statement-breakpoint
CREATE TRIGGER `trg_shipping_containers_validate_status`
BEFORE UPDATE OF `status` ON `shipping_containers`
FOR EACH ROW
WHEN NOT (
	(OLD.`status` = 'DRAFT' AND NEW.`status` IN ('PLANNED', 'CANCELLED'))
	OR (OLD.`status` = 'PLANNED' AND NEW.`status` IN ('LOADING', 'CANCELLED'))
	OR (OLD.`status` = 'LOADING' AND NEW.`status` IN ('SEALED', 'CANCELLED'))
	OR (OLD.`status` = 'SEALED' AND NEW.`status` = 'IN_TRANSIT')
	OR (OLD.`status` = 'IN_TRANSIT' AND NEW.`status` = 'ARRIVED')
	OR (OLD.`status` = 'ARRIVED' AND NEW.`status` = 'UNLOADING')
	OR (OLD.`status` = 'UNLOADING' AND NEW.`status` = 'COMPLETED')
)
OR (
	NEW.`status` IN ('PLANNED', 'LOADING')
	AND NOT EXISTS (
		SELECT 1 FROM `container_motorcycle_assignments`
		WHERE `container_id` = NEW.`id` AND `released_at` IS NULL
	)
)
OR (
	NEW.`status` = 'SEALED'
	AND (
		NEW.`seal_number` IS NULL
		OR NOT EXISTS (
			SELECT 1 FROM `container_motorcycle_assignments`
			WHERE `container_id` = NEW.`id` AND `released_at` IS NULL
		)
		OR EXISTS (
			SELECT 1 FROM `container_motorcycle_assignments` assignment
			JOIN `motorcycles` motorcycle ON motorcycle.`id` = assignment.`motorcycle_id`
			WHERE assignment.`container_id` = NEW.`id`
			AND assignment.`released_at` IS NULL
			AND (assignment.`state` <> 'LOADED' OR motorcycle.`current_status` <> 'LOADED')
		)
	)
)
OR (
	NEW.`status` = 'IN_TRANSIT'
	AND (
		NOT EXISTS (
			SELECT 1 FROM `container_motorcycle_assignments`
			WHERE `container_id` = NEW.`id` AND `released_at` IS NULL
		)
		OR EXISTS (
			SELECT 1 FROM `container_motorcycle_assignments` assignment
			JOIN `motorcycles` motorcycle ON motorcycle.`id` = assignment.`motorcycle_id`
			WHERE assignment.`container_id` = NEW.`id`
			AND assignment.`released_at` IS NULL
			AND (assignment.`state` <> 'LOADED' OR motorcycle.`current_status` <> 'IN_TRANSIT')
		)
	)
)
OR (
	NEW.`status` IN ('ARRIVED', 'UNLOADING')
	AND (
		NOT EXISTS (
			SELECT 1 FROM `container_motorcycle_assignments`
			WHERE `container_id` = NEW.`id` AND `released_at` IS NULL
		)
		OR EXISTS (
			SELECT 1 FROM `container_motorcycle_assignments` assignment
			JOIN `motorcycles` motorcycle ON motorcycle.`id` = assignment.`motorcycle_id`
			WHERE assignment.`container_id` = NEW.`id`
			AND assignment.`released_at` IS NULL
			AND (assignment.`state` <> 'LOADED' OR motorcycle.`current_status` NOT IN ('ARRIVED', 'DELIVERED', 'CLOSED'))
		)
	)
)
OR (
	NEW.`status` = 'COMPLETED'
	AND (
		NOT EXISTS (
			SELECT 1 FROM `container_motorcycle_assignments`
			WHERE `container_id` = NEW.`id` AND `released_at` IS NULL
		)
		OR EXISTS (
			SELECT 1 FROM `container_motorcycle_assignments` assignment
			JOIN `motorcycles` motorcycle ON motorcycle.`id` = assignment.`motorcycle_id`
			WHERE assignment.`container_id` = NEW.`id`
			AND assignment.`released_at` IS NULL
			AND (assignment.`state` <> 'UNLOADED' OR motorcycle.`current_status` NOT IN ('DELIVERED', 'CLOSED'))
		)
	)
)
OR (
	NEW.`status` = 'CANCELLED'
	AND EXISTS (
		SELECT 1 FROM `container_motorcycle_assignments`
		WHERE `container_id` = NEW.`id` AND `released_at` IS NULL AND `state` <> 'ASSIGNED'
	)
)
BEGIN
	SELECT RAISE(ABORT, 'container status is incompatible with assigned motorcycle readiness');
END;
