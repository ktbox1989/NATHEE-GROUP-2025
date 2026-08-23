CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT `ck_posts_slug_shape` CHECK (length(`slug`) BETWEEN 1 AND 80 AND `slug` NOT GLOB '*[^a-z0-9-]*' AND `slug` NOT LIKE '-%' AND `slug` NOT LIKE '%-' AND `slug` NOT LIKE '%--%'),
	CONSTRAINT `ck_posts_slug_reserved` CHECK (`slug` NOT IN ('page', 'feed', 'rss', 'atom', 'sitemap', 'index', 'all', 'category', 'tag'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_posts_slug` ON `posts` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_posts_updated` ON `posts` (`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `post_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`post_id` text NOT NULL,
	`content_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`change_note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT `ck_post_revisions_json` CHECK (json_valid(`content_json`) AND length(`content_json`) BETWEEN 2 AND 50000),
	CONSTRAINT `ck_post_revisions_hash` CHECK (length(`content_hash`) = 64 AND `content_hash` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `ck_post_revisions_note` CHECK (`change_note` IS NULL OR length(`change_note`) <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_post_revisions_request_key` ON `post_revisions` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_post_revisions_post_created` ON `post_revisions` (`post_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `post_publication_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`post_id` text NOT NULL,
	`revision_id` text,
	`action` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`revision_id`) REFERENCES `post_revisions`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT `ck_post_publication_action` CHECK (`action` IN ('PUBLISH', 'HIDE')),
	CONSTRAINT `ck_post_publication_revision` CHECK ((`action` = 'PUBLISH' AND `revision_id` IS NOT NULL) OR (`action` = 'HIDE' AND `revision_id` IS NULL)),
	CONSTRAINT `ck_post_publication_note` CHECK (`note` IS NULL OR length(`note`) <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_post_publication_request_key` ON `post_publication_events` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_post_publication_post_created` ON `post_publication_events` (`post_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_post_publication_revision` ON `post_publication_events` (`revision_id`);--> statement-breakpoint
CREATE TRIGGER `trg_post_revisions_immutable_update`
BEFORE UPDATE ON `post_revisions`
BEGIN
  SELECT RAISE(ABORT, 'post revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_post_revisions_no_delete`
BEFORE DELETE ON `post_revisions`
BEGIN
  SELECT RAISE(ABORT, 'post revisions cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_post_publications_immutable_update`
BEFORE UPDATE ON `post_publication_events`
BEGIN
  SELECT RAISE(ABORT, 'post publications are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_post_publications_no_delete`
BEFORE DELETE ON `post_publication_events`
BEGIN
  SELECT RAISE(ABORT, 'post publications cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_post_publication_revision_scope`
BEFORE INSERT ON `post_publication_events`
WHEN NEW.`action` = 'PUBLISH'
  AND NOT EXISTS (
    SELECT 1 FROM `post_revisions`
    WHERE `id` = NEW.`revision_id` AND `post_id` = NEW.`post_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'published revision must belong to the same post');
END;
