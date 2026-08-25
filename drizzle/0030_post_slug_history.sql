CREATE TABLE `post_slug_history` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`post_id` text NOT NULL,
	`from_slug` text NOT NULL,
	`to_slug` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT `ck_post_slug_history_from_shape` CHECK (length(`from_slug`) BETWEEN 1 AND 80 AND `from_slug` NOT GLOB '*[^a-z0-9-]*' AND `from_slug` NOT LIKE '-%' AND `from_slug` NOT LIKE '%-' AND `from_slug` NOT LIKE '%--%'),
	CONSTRAINT `ck_post_slug_history_to_shape` CHECK (length(`to_slug`) BETWEEN 1 AND 80 AND `to_slug` NOT GLOB '*[^a-z0-9-]*' AND `to_slug` NOT LIKE '-%' AND `to_slug` NOT LIKE '%-' AND `to_slug` NOT LIKE '%--%'),
	CONSTRAINT `ck_post_slug_history_distinct` CHECK (`from_slug` <> `to_slug`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_post_slug_history_request_key` ON `post_slug_history` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_post_slug_history_from_created` ON `post_slug_history` (`from_slug`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_post_slug_history_post_created` ON `post_slug_history` (`post_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TRIGGER `trg_post_slug_history_immutable_update`
BEFORE UPDATE ON `post_slug_history`
BEGIN
  SELECT RAISE(ABORT, 'post slug history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_post_slug_history_no_delete`
BEFORE DELETE ON `post_slug_history`
BEGIN
  SELECT RAISE(ABORT, 'post slug history cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_post_slug_history_target_is_current`
BEFORE INSERT ON `post_slug_history`
WHEN NOT EXISTS (
    SELECT 1 FROM `posts`
    WHERE `id` = NEW.`post_id` AND `slug` = NEW.`to_slug`
  )
BEGIN
  SELECT RAISE(ABORT, 'a slug history row must name the slug the post now has');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_post_slug_history_source_is_free`
BEFORE INSERT ON `post_slug_history`
WHEN EXISTS (
    SELECT 1 FROM `posts` WHERE `slug` = NEW.`from_slug`
  )
BEGIN
  SELECT RAISE(ABORT, 'a previous slug cannot still belong to a live post');
END;
