PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_gallery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`category_id` text NOT NULL,
	`company_id` text,
	`job_id` text,
	`title` text NOT NULL,
	`caption` text,
	`alt_text` text NOT NULL,
	`taken_at` text,
	`location` text,
	`public_job_reference` text,
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
	CONSTRAINT "ck_gallery_items_title" CHECK(length("__new_gallery_items"."title") BETWEEN 1 AND 160),
	CONSTRAINT "ck_gallery_items_alt" CHECK(length("__new_gallery_items"."alt_text") BETWEEN 3 AND 300),
	CONSTRAINT "ck_gallery_items_location" CHECK("__new_gallery_items"."location" IS NULL OR length("__new_gallery_items"."location") <= 200),
	CONSTRAINT "ck_gallery_items_public_job_reference" CHECK("__new_gallery_items"."public_job_reference" IS NULL OR length("__new_gallery_items"."public_job_reference") <= 100),
	CONSTRAINT "ck_gallery_items_status" CHECK("__new_gallery_items"."status" IN ('DRAFT', 'PUBLISHED', 'HIDDEN', 'ARCHIVED')),
	CONSTRAINT "ck_gallery_items_visibility" CHECK("__new_gallery_items"."visibility" IN ('PUBLIC', 'CUSTOMER_JOB', 'INTERNAL')),
	CONSTRAINT "ck_gallery_items_sort" CHECK("__new_gallery_items"."sort_order" >= 0),
	CONSTRAINT "ck_gallery_items_featured" CHECK("__new_gallery_items"."is_featured" IN (0, 1)),
	CONSTRAINT "ck_gallery_items_customer_scope" CHECK("__new_gallery_items"."visibility" <> 'CUSTOMER_JOB' OR ("__new_gallery_items"."company_id" IS NOT NULL AND "__new_gallery_items"."job_id" IS NOT NULL)),
	CONSTRAINT "ck_gallery_items_public_scope" CHECK("__new_gallery_items"."visibility" <> 'PUBLIC' OR ("__new_gallery_items"."company_id" IS NULL AND "__new_gallery_items"."job_id" IS NULL)),
	CONSTRAINT "ck_gallery_items_published_actor" CHECK("__new_gallery_items"."status" <> 'PUBLISHED' OR ("__new_gallery_items"."published_by" IS NOT NULL AND "__new_gallery_items"."published_at" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_gallery_items`("id", "request_key", "category_id", "company_id", "job_id", "title", "caption", "alt_text", "taken_at", "location", "public_job_reference", "status", "visibility", "sort_order", "is_featured", "uploaded_by", "published_by", "published_at", "archived_at", "created_at", "updated_at") SELECT "id", "request_key", "category_id", "company_id", "job_id", "title", "caption", "alt_text", NULL, NULL, NULL, "status", "visibility", "sort_order", "is_featured", "uploaded_by", "published_by", "published_at", "archived_at", "created_at", "updated_at" FROM `gallery_items`;--> statement-breakpoint
DROP TABLE `gallery_items`;--> statement-breakpoint
ALTER TABLE `__new_gallery_items` RENAME TO `gallery_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gallery_items_request_key` ON `gallery_items` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_gallery_items_public_order` ON `gallery_items` (`visibility`,`status`,`is_featured`,`sort_order`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_gallery_items_category_order` ON `gallery_items` (`category_id`,`status`,`sort_order`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_gallery_items_company_job` ON `gallery_items` (`company_id`,`job_id`,`status`,`created_at`);
