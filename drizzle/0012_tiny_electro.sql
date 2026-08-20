CREATE TABLE `site_page_publication_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`page_id` text NOT NULL,
	`revision_id` text,
	`action` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `site_pages`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`revision_id`) REFERENCES `site_page_revisions`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_site_page_publication_action" CHECK("site_page_publication_events"."action" IN ('PUBLISH', 'HIDE')),
	CONSTRAINT "ck_site_page_publication_revision" CHECK(("site_page_publication_events"."action" = 'PUBLISH' AND "site_page_publication_events"."revision_id" IS NOT NULL) OR ("site_page_publication_events"."action" = 'HIDE' AND "site_page_publication_events"."revision_id" IS NULL)),
	CONSTRAINT "ck_site_page_publication_note" CHECK("site_page_publication_events"."note" IS NULL OR length("site_page_publication_events"."note") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_site_page_publication_request_key` ON `site_page_publication_events` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_site_page_publication_page_created` ON `site_page_publication_events` (`page_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_site_page_publication_revision` ON `site_page_publication_events` (`revision_id`);--> statement-breakpoint
CREATE TABLE `site_page_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`page_id` text NOT NULL,
	`content_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`change_note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `site_pages`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_site_page_revisions_json" CHECK(json_valid("site_page_revisions"."content_json") AND length("site_page_revisions"."content_json") BETWEEN 2 AND 50000),
	CONSTRAINT "ck_site_page_revisions_hash" CHECK(length("site_page_revisions"."content_hash") = 64 AND "site_page_revisions"."content_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "ck_site_page_revisions_note" CHECK("site_page_revisions"."change_note" IS NULL OR length("site_page_revisions"."change_note") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_site_page_revisions_request_key` ON `site_page_revisions` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_site_page_revisions_page_created` ON `site_page_revisions` (`page_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `site_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_site_pages_slug" CHECK(length("site_pages"."slug") BETWEEN 2 AND 80 AND "site_pages"."slug" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "ck_site_pages_display_name" CHECK(length("site_pages"."display_name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_site_pages_slug` ON `site_pages` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_site_pages_updated` ON `site_pages` (`updated_at`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_permissions` (
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `permission`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_user_permissions_permission" CHECK("__new_user_permissions"."permission" IN ('companies:read', 'companies:write', 'jobs:read', 'jobs:write', 'motorcycles:read', 'motorcycles:write', 'images:read', 'images:write', 'status:read', 'status:write', 'yard:read', 'yard:write', 'documents:read', 'audit:read', 'gallery:read', 'gallery:write', 'gallery:publish', 'site:read', 'site:write', 'site:publish'))
);
--> statement-breakpoint
INSERT INTO `__new_user_permissions`("user_id", "permission", "granted_by", "created_at") SELECT "user_id", "permission", "granted_by", "created_at" FROM `user_permissions`;--> statement-breakpoint
DROP TABLE `user_permissions`;--> statement-breakpoint
ALTER TABLE `__new_user_permissions` RENAME TO `user_permissions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_user_permissions_user` ON `user_permissions` (`user_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_site_pages_no_delete`
BEFORE DELETE ON `site_pages`
BEGIN
  SELECT RAISE(ABORT, 'site pages cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_site_pages_identity_immutable`
BEFORE UPDATE ON `site_pages`
WHEN NEW.`id` <> OLD.`id`
  OR NEW.`slug` <> OLD.`slug`
  OR NEW.`created_by` <> OLD.`created_by`
  OR NEW.`created_at` <> OLD.`created_at`
BEGIN
  SELECT RAISE(ABORT, 'site page identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_site_page_revisions_immutable_update`
BEFORE UPDATE ON `site_page_revisions`
BEGIN
  SELECT RAISE(ABORT, 'site page revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_site_page_revisions_no_delete`
BEFORE DELETE ON `site_page_revisions`
BEGIN
  SELECT RAISE(ABORT, 'site page revisions cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_site_page_publications_immutable_update`
BEFORE UPDATE ON `site_page_publication_events`
BEGIN
  SELECT RAISE(ABORT, 'site page publications are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_site_page_publications_no_delete`
BEFORE DELETE ON `site_page_publication_events`
BEGIN
  SELECT RAISE(ABORT, 'site page publications cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_site_page_publication_revision_scope`
BEFORE INSERT ON `site_page_publication_events`
WHEN NEW.`action` = 'PUBLISH'
  AND NOT EXISTS (
    SELECT 1 FROM `site_page_revisions`
    WHERE `id` = NEW.`revision_id` AND `page_id` = NEW.`page_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'published revision must belong to the same page');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_site_home_cannot_hide`
BEFORE INSERT ON `site_page_publication_events`
WHEN NEW.`action` = 'HIDE'
  AND EXISTS (SELECT 1 FROM `site_pages` WHERE `id` = NEW.`page_id` AND `slug` = 'home')
BEGIN
  SELECT RAISE(ABORT, 'home page cannot be hidden');
END;
--> statement-breakpoint
PRAGMA optimize;
