CREATE TABLE `yard_placements` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`motorcycle_id` text NOT NULL,
	`company_id` text NOT NULL,
	`yard_zone_id` text NOT NULL,
	`entered_at` text NOT NULL,
	`exited_at` text,
	`placed_by` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`motorcycle_id`) REFERENCES `motorcycles`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`yard_zone_id`) REFERENCES `yard_zones`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`placed_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_yard_placements_time_order" CHECK("yard_placements"."exited_at" IS NULL OR "yard_placements"."exited_at" >= "yard_placements"."entered_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_yard_placements_request_key` ON `yard_placements` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_yard_placements_motorcycle_active` ON `yard_placements` (`motorcycle_id`) WHERE "yard_placements"."exited_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_yard_placements_zone_active` ON `yard_placements` (`yard_zone_id`,`entered_at`) WHERE "yard_placements"."exited_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_yard_placements_company_entered` ON `yard_placements` (`company_id`,`entered_at`);--> statement-breakpoint
CREATE INDEX `idx_yard_placements_motorcycle_entered` ON `yard_placements` (`motorcycle_id`,`entered_at`);--> statement-breakpoint
CREATE TABLE `yard_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`capacity` integer,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_yard_zones_code" CHECK(length("yard_zones"."code") BETWEEN 2 AND 30),
	CONSTRAINT "ck_yard_zones_capacity" CHECK("yard_zones"."capacity" IS NULL OR "yard_zones"."capacity" > 0),
	CONSTRAINT "ck_yard_zones_status" CHECK("yard_zones"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_yard_zones_code` ON `yard_zones` (`code`);--> statement-breakpoint
CREATE INDEX `idx_yard_zones_status_code` ON `yard_zones` (`status`,`code`);--> statement-breakpoint
CREATE TABLE `__new_user_permissions` (
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `permission`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_user_permissions_permission" CHECK("__new_user_permissions"."permission" IN ('companies:read', 'companies:write', 'jobs:read', 'jobs:write', 'motorcycles:read', 'motorcycles:write', 'images:read', 'images:write', 'status:read', 'status:write', 'yard:read', 'yard:write', 'documents:read', 'audit:read'))
);
--> statement-breakpoint
INSERT INTO `__new_user_permissions`("user_id", "permission", "granted_by", "created_at") SELECT "user_id", "permission", "granted_by", "created_at" FROM `user_permissions`;--> statement-breakpoint
DROP TABLE `user_permissions`;--> statement-breakpoint
ALTER TABLE `__new_user_permissions` RENAME TO `user_permissions`;--> statement-breakpoint
CREATE INDEX `idx_user_permissions_user` ON `user_permissions` (`user_id`);
