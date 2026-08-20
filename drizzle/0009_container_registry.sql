CREATE TABLE `container_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`container_id` text NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`container_id`) REFERENCES `shipping_containers`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_container_status_events_previous" CHECK("container_status_events"."previous_status" IS NULL OR "container_status_events"."previous_status" IN ('DRAFT', 'PLANNED', 'LOADING', 'SEALED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "ck_container_status_events_new" CHECK("container_status_events"."new_status" IN ('DRAFT', 'PLANNED', 'LOADING', 'SEALED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING', 'COMPLETED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX `idx_container_status_events_container_created` ON `container_status_events` (`container_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `shipping_containers` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`public_id` text NOT NULL,
	`container_number` text NOT NULL,
	`seal_number` text,
	`type` text NOT NULL,
	`capacity_motorcycles` integer,
	`port` text NOT NULL,
	`country` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_shipping_containers_number" CHECK(length("shipping_containers"."container_number") = 11 AND "shipping_containers"."container_number" GLOB '[A-Z][A-Z][A-Z][UJZ][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
	CONSTRAINT "ck_shipping_containers_seal" CHECK("shipping_containers"."seal_number" IS NULL OR length("shipping_containers"."seal_number") BETWEEN 2 AND 50),
	CONSTRAINT "ck_shipping_containers_type" CHECK("shipping_containers"."type" IN ('20FT', '40FT', '40HC')),
	CONSTRAINT "ck_shipping_containers_capacity" CHECK("shipping_containers"."capacity_motorcycles" IS NULL OR "shipping_containers"."capacity_motorcycles" BETWEEN 1 AND 1000),
	CONSTRAINT "ck_shipping_containers_port" CHECK(length("shipping_containers"."port") BETWEEN 2 AND 100),
	CONSTRAINT "ck_shipping_containers_country" CHECK(length("shipping_containers"."country") BETWEEN 2 AND 100),
	CONSTRAINT "ck_shipping_containers_status" CHECK("shipping_containers"."status" IN ('DRAFT', 'PLANNED', 'LOADING', 'SEALED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING', 'COMPLETED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shipping_containers_request_key` ON `shipping_containers` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shipping_containers_public_id` ON `shipping_containers` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shipping_containers_number` ON `shipping_containers` (`container_number`);--> statement-breakpoint
CREATE INDEX `idx_shipping_containers_status_created` ON `shipping_containers` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TRIGGER `trg_shipping_containers_identity_immutable`
BEFORE UPDATE OF `request_key`, `public_id`, `container_number`, `created_by`, `created_at`
ON `shipping_containers`
FOR EACH ROW
WHEN NEW.`request_key` <> OLD.`request_key`
OR NEW.`public_id` <> OLD.`public_id`
OR NEW.`container_number` <> OLD.`container_number`
OR NEW.`created_by` <> OLD.`created_by`
OR NEW.`created_at` <> OLD.`created_at`
BEGIN
	SELECT RAISE(ABORT, 'shipping container identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `trg_shipping_containers_lifecycle_not_activated`
BEFORE UPDATE OF `status` ON `shipping_containers`
FOR EACH ROW
WHEN NEW.`status` <> OLD.`status`
BEGIN
	SELECT RAISE(ABORT, 'container lifecycle requires the vehicle assignment milestone');
END;--> statement-breakpoint
CREATE TRIGGER `trg_shipping_containers_no_delete`
BEFORE DELETE ON `shipping_containers`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'shipping container history cannot be deleted');
END;
