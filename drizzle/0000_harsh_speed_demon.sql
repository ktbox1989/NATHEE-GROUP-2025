CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`company_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_entity_created` ON `audit_logs` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_company_created` ON `audit_logs` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`legal_name` text NOT NULL,
	`display_name` text NOT NULL,
	`tax_id` text,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "ck_companies_status" CHECK("companies"."status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_companies_code` ON `companies` (`code`);--> statement-breakpoint
CREATE INDEX `idx_companies_status` ON `companies` (`status`);--> statement-breakpoint
CREATE TABLE `motorcycle_images` (
	`id` text PRIMARY KEY NOT NULL,
	`motorcycle_id` text NOT NULL,
	`company_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`category` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`checksum` text,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`motorcycle_id`) REFERENCES `motorcycles`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_motorcycle_images_category" CHECK("motorcycle_images"."category" IN ('FRONT', 'REAR', 'LEFT', 'RIGHT', 'DAMAGE', 'DELIVERY', 'OTHER')),
	CONSTRAINT "ck_motorcycle_images_size_positive" CHECK("motorcycle_images"."byte_size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_images_storage_key` ON `motorcycle_images` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_motorcycle_images_motorcycle_created` ON `motorcycle_images` (`motorcycle_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_motorcycle_images_company` ON `motorcycle_images` (`company_id`);--> statement-breakpoint
CREATE TABLE `motorcycles` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`company_id` text NOT NULL,
	`job_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`make` text,
	`model` text,
	`color` text,
	`registration` text,
	`vin` text,
	`engine_number` text,
	`current_status` text DEFAULT 'PENDING_RECEIPT' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`job_id`) REFERENCES `transport_jobs`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_motorcycles_sequence_positive" CHECK("motorcycles"."sequence_number" > 0),
	CONSTRAINT "ck_motorcycles_status" CHECK("motorcycles"."current_status" IN ('PENDING_RECEIPT', 'RECEIVED', 'INSPECTED', 'IN_YARD', 'SCHEDULED', 'LOADED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'CLOSED', 'ISSUE', 'DAMAGED', 'WAITING_DOCUMENTS', 'CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycles_public_id` ON `motorcycles` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycles_job_sequence` ON `motorcycles` (`job_id`,`sequence_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycles_vin` ON `motorcycles` (`vin`) WHERE "motorcycles"."vin" IS NOT NULL AND "motorcycles"."vin" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycles_engine_number` ON `motorcycles` (`engine_number`) WHERE "motorcycles"."engine_number" IS NOT NULL AND "motorcycles"."engine_number" <> '';--> statement-breakpoint
CREATE INDEX `idx_motorcycles_company_status` ON `motorcycles` (`company_id`,`current_status`);--> statement-breakpoint
CREATE INDEX `idx_motorcycles_job` ON `motorcycles` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_motorcycles_registration` ON `motorcycles` (`registration`);--> statement-breakpoint
CREATE TABLE `quote_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`request_number` text NOT NULL,
	`company_name` text,
	`contact_name` text NOT NULL,
	`phone` text NOT NULL,
	`line_id` text,
	`email` text,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`quantity` integer NOT NULL,
	`vehicle_type` text,
	`desired_date` text,
	`extras_json` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`status` text DEFAULT 'NEW' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "ck_quote_requests_quantity_positive" CHECK("quote_requests"."quantity" > 0),
	CONSTRAINT "ck_quote_requests_status" CHECK("quote_requests"."status" IN ('NEW', 'CONTACTED', 'QUOTED', 'ACCEPTED', 'REJECTED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_quote_requests_request_number` ON `quote_requests` (`request_number`);--> statement-breakpoint
CREATE INDEX `idx_quote_requests_status_created` ON `quote_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `sequence_counters` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`motorcycle_id` text NOT NULL,
	`company_id` text NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`motorcycle_id`) REFERENCES `motorcycles`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_status_events_previous_status" CHECK("status_events"."previous_status" IS NULL OR "status_events"."previous_status" IN ('PENDING_RECEIPT', 'RECEIVED', 'INSPECTED', 'IN_YARD', 'SCHEDULED', 'LOADED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'CLOSED', 'ISSUE', 'DAMAGED', 'WAITING_DOCUMENTS', 'CANCELLED')),
	CONSTRAINT "ck_status_events_new_status" CHECK("status_events"."new_status" IN ('PENDING_RECEIPT', 'RECEIVED', 'INSPECTED', 'IN_YARD', 'SCHEDULED', 'LOADED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'CLOSED', 'ISSUE', 'DAMAGED', 'WAITING_DOCUMENTS', 'CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX `idx_status_events_motorcycle_created` ON `status_events` (`motorcycle_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_status_events_company_created` ON `status_events` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `transport_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_number` text NOT NULL,
	`company_id` text NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`planned_pickup_date` text,
	`planned_delivery_date` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_transport_jobs_status" CHECK("transport_jobs"."status" IN ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_transport_jobs_job_number` ON `transport_jobs` (`job_number`);--> statement-breakpoint
CREATE INDEX `idx_transport_jobs_company_created` ON `transport_jobs` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_transport_jobs_status` ON `transport_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `user_permissions` (
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `permission`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_user_permissions_permission" CHECK("user_permissions"."permission" IN ('companies:read', 'companies:write', 'jobs:read', 'jobs:write', 'motorcycles:read', 'motorcycles:write', 'images:read', 'images:write', 'status:read', 'status:write', 'documents:read', 'audit:read'))
);
--> statement-breakpoint
CREATE INDEX `idx_user_permissions_user` ON `user_permissions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`external_auth_id` text NOT NULL,
	`email` text NOT NULL,
	`username` text,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`company_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_customer_requires_company" CHECK("users"."role" <> 'CUSTOMER' OR "users"."company_id" IS NOT NULL),
	CONSTRAINT "ck_users_role" CHECK("users"."role" IN ('OWNER', 'STAFF', 'CUSTOMER')),
	CONSTRAINT "ck_users_status" CHECK("users"."status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_external_auth_id` ON `users` (`external_auth_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_company_role` ON `users` (`company_id`,`role`);--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);