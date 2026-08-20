CREATE TABLE `gallery_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_gallery_categories_slug" CHECK(length("gallery_categories"."slug") BETWEEN 2 AND 80 AND "gallery_categories"."slug" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "ck_gallery_categories_name" CHECK(length("gallery_categories"."name") BETWEEN 1 AND 120),
	CONSTRAINT "ck_gallery_categories_status" CHECK("gallery_categories"."status" IN ('ACTIVE', 'HIDDEN')),
	CONSTRAINT "ck_gallery_categories_sort" CHECK("gallery_categories"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gallery_categories_slug` ON `gallery_categories` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_gallery_categories_status_sort` ON `gallery_categories` (`status`,`sort_order`,`name`);--> statement-breakpoint
CREATE TABLE `gallery_image_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`gallery_item_id` text NOT NULL,
	`role` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer,
	`height` integer,
	`byte_size` integer NOT NULL,
	`checksum` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`gallery_item_id`) REFERENCES `gallery_items`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_gallery_image_variants_role" CHECK("gallery_image_variants"."role" IN ('ORIGINAL', 'DISPLAY', 'THUMBNAIL')),
	CONSTRAINT "ck_gallery_image_variants_content_type" CHECK("gallery_image_variants"."content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif')),
	CONSTRAINT "ck_gallery_image_variants_size" CHECK("gallery_image_variants"."byte_size" > 0),
	CONSTRAINT "ck_gallery_image_variants_width" CHECK("gallery_image_variants"."width" IS NULL OR "gallery_image_variants"."width" > 0),
	CONSTRAINT "ck_gallery_image_variants_height" CHECK("gallery_image_variants"."height" IS NULL OR "gallery_image_variants"."height" > 0),
	CONSTRAINT "ck_gallery_image_variants_checksum" CHECK(length("gallery_image_variants"."checksum") = 64 AND "gallery_image_variants"."checksum" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gallery_image_variants_storage_key` ON `gallery_image_variants` (`storage_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gallery_image_variants_item_role_type` ON `gallery_image_variants` (`gallery_item_id`,`role`,`content_type`);--> statement-breakpoint
CREATE INDEX `idx_gallery_image_variants_item_role` ON `gallery_image_variants` (`gallery_item_id`,`role`);--> statement-breakpoint
CREATE TABLE `gallery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`category_id` text NOT NULL,
	`company_id` text,
	`job_id` text,
	`title` text NOT NULL,
	`caption` text,
	`alt_text` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`visibility` text DEFAULT 'INTERNAL' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_featured` integer DEFAULT 0 NOT NULL,
	`uploaded_by` text NOT NULL,
	`published_by` text,
	`published_at` text,
	`archived_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `gallery_categories`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`job_id`) REFERENCES `transport_jobs`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_gallery_items_title" CHECK(length("gallery_items"."title") BETWEEN 1 AND 160),
	CONSTRAINT "ck_gallery_items_alt" CHECK(length("gallery_items"."alt_text") BETWEEN 3 AND 300),
	CONSTRAINT "ck_gallery_items_status" CHECK("gallery_items"."status" IN ('DRAFT', 'PUBLISHED', 'HIDDEN', 'ARCHIVED')),
	CONSTRAINT "ck_gallery_items_visibility" CHECK("gallery_items"."visibility" IN ('PUBLIC', 'CUSTOMER_JOB', 'INTERNAL')),
	CONSTRAINT "ck_gallery_items_sort" CHECK("gallery_items"."sort_order" >= 0),
	CONSTRAINT "ck_gallery_items_featured" CHECK("gallery_items"."is_featured" IN (0, 1)),
	CONSTRAINT "ck_gallery_items_customer_scope" CHECK("gallery_items"."visibility" <> 'CUSTOMER_JOB' OR ("gallery_items"."company_id" IS NOT NULL AND "gallery_items"."job_id" IS NOT NULL)),
	CONSTRAINT "ck_gallery_items_public_scope" CHECK("gallery_items"."visibility" <> 'PUBLIC' OR ("gallery_items"."company_id" IS NULL AND "gallery_items"."job_id" IS NULL)),
	CONSTRAINT "ck_gallery_items_published_actor" CHECK("gallery_items"."status" <> 'PUBLISHED' OR ("gallery_items"."published_by" IS NOT NULL AND "gallery_items"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gallery_items_request_key` ON `gallery_items` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_gallery_items_public_order` ON `gallery_items` (`visibility`,`status`,`is_featured`,`sort_order`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_gallery_items_category_order` ON `gallery_items` (`category_id`,`status`,`sort_order`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_gallery_items_company_job` ON `gallery_items` (`company_id`,`job_id`,`status`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_permissions` (
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `permission`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_user_permissions_permission" CHECK("__new_user_permissions"."permission" IN ('companies:read', 'companies:write', 'jobs:read', 'jobs:write', 'motorcycles:read', 'motorcycles:write', 'images:read', 'images:write', 'status:read', 'status:write', 'yard:read', 'yard:write', 'documents:read', 'audit:read', 'gallery:read', 'gallery:write', 'gallery:publish'))
);
--> statement-breakpoint
INSERT INTO `__new_user_permissions`("user_id", "permission", "granted_by", "created_at") SELECT "user_id", "permission", "granted_by", "created_at" FROM `user_permissions`;--> statement-breakpoint
DROP TABLE `user_permissions`;--> statement-breakpoint
ALTER TABLE `__new_user_permissions` RENAME TO `user_permissions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_user_permissions_user` ON `user_permissions` (`user_id`);