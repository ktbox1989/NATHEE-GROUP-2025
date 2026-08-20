CREATE TABLE `trip_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_trip_status_events_previous" CHECK("trip_status_events"."previous_status" IS NULL OR "trip_status_events"."previous_status" IN ('DRAFT', 'PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "ck_trip_status_events_new" CHECK("trip_status_events"."new_status" IN ('DRAFT', 'PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX `idx_trip_status_events_trip_created` ON `trip_status_events` (`trip_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`public_id` text NOT NULL,
	`trip_number` text NOT NULL,
	`truck_id` text NOT NULL,
	`driver_user_id` text,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`planned_departure_at` text,
	`planned_arrival_at` text,
	`actual_departure_at` text,
	`actual_arrival_at` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`truck_id`) REFERENCES `trucks`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`driver_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_trips_status" CHECK("trips"."status" IN ('DRAFT', 'PLANNED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "ck_trips_route" CHECK(length("trips"."origin") BETWEEN 1 AND 200 AND length("trips"."destination") BETWEEN 1 AND 200),
	CONSTRAINT "ck_trips_planned_order" CHECK("trips"."planned_arrival_at" IS NULL OR "trips"."planned_departure_at" IS NULL OR "trips"."planned_arrival_at" >= "trips"."planned_departure_at"),
	CONSTRAINT "ck_trips_actual_order" CHECK("trips"."actual_arrival_at" IS NULL OR "trips"."actual_departure_at" IS NULL OR "trips"."actual_arrival_at" >= "trips"."actual_departure_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trips_request_key` ON `trips` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trips_public_id` ON `trips` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trips_trip_number` ON `trips` (`trip_number`);--> statement-breakpoint
CREATE INDEX `idx_trips_status_planned` ON `trips` (`status`,`planned_departure_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_trips_truck_status` ON `trips` (`truck_id`,`status`,`planned_departure_at`);--> statement-breakpoint
CREATE INDEX `idx_trips_driver_status` ON `trips` (`driver_user_id`,`status`,`planned_departure_at`);--> statement-breakpoint
CREATE TABLE `trucks` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`public_id` text NOT NULL,
	`code` text NOT NULL,
	`registration` text,
	`type` text NOT NULL,
	`capacity_motorcycles` integer,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_trucks_code" CHECK(length("trucks"."code") BETWEEN 2 AND 30 AND "trucks"."code" NOT GLOB '*[^A-Z0-9-]*'),
	CONSTRAINT "ck_trucks_registration" CHECK("trucks"."registration" IS NULL OR length("trucks"."registration") BETWEEN 2 AND 30),
	CONSTRAINT "ck_trucks_type" CHECK("trucks"."type" IN ('FOUR_WHEEL', 'SIX_WHEEL', 'OTHER')),
	CONSTRAINT "ck_trucks_capacity" CHECK("trucks"."capacity_motorcycles" IS NULL OR "trucks"."capacity_motorcycles" BETWEEN 1 AND 1000),
	CONSTRAINT "ck_trucks_status" CHECK("trucks"."status" IN ('ACTIVE', 'MAINTENANCE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trucks_request_key` ON `trucks` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trucks_public_id` ON `trucks` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trucks_code` ON `trucks` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trucks_registration` ON `trucks` (`registration`) WHERE "trucks"."registration" IS NOT NULL AND "trucks"."registration" <> '';--> statement-breakpoint
CREATE INDEX `idx_trucks_status_code` ON `trucks` (`status`,`code`);--> statement-breakpoint
CREATE TRIGGER `trg_trips_validate_resources_insert`
BEFORE INSERT ON `trips`
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM `trucks` WHERE `id` = NEW.`truck_id` AND `status` = 'ACTIVE')
OR (
	NEW.`driver_user_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `users` u
		LEFT JOIN `user_role_assignments` r ON r.`user_id` = u.`id`
		WHERE u.`id` = NEW.`driver_user_id` AND u.`status` = 'ACTIVE'
		AND COALESCE(r.`role`, CASE u.`role` WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END) = 'DRIVER'
	)
)
BEGIN
	SELECT RAISE(ABORT, 'trip requires an active truck and active driver role');
END;--> statement-breakpoint
CREATE TRIGGER `trg_trips_validate_resources_update`
BEFORE UPDATE OF `truck_id`, `driver_user_id` ON `trips`
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM `trucks` WHERE `id` = NEW.`truck_id` AND `status` = 'ACTIVE')
OR (
	NEW.`driver_user_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `users` u
		LEFT JOIN `user_role_assignments` r ON r.`user_id` = u.`id`
		WHERE u.`id` = NEW.`driver_user_id` AND u.`status` = 'ACTIVE'
		AND COALESCE(r.`role`, CASE u.`role` WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END) = 'DRIVER'
	)
)
BEGIN
	SELECT RAISE(ABORT, 'trip requires an active truck and active driver role');
END;
