CREATE TABLE `site_settings_publication_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`revision_id` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `site_settings_revisions`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_site_settings_publication_note" CHECK("site_settings_publication_events"."note" IS NULL OR length("site_settings_publication_events"."note") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_site_settings_publication_request_key` ON `site_settings_publication_events` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_site_settings_publication_created` ON `site_settings_publication_events` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_site_settings_publication_revision` ON `site_settings_publication_events` (`revision_id`);--> statement-breakpoint
CREATE TABLE `site_settings_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`settings_json` text NOT NULL,
	`settings_hash` text NOT NULL,
	`change_note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_site_settings_revisions_json" CHECK(json_valid("site_settings_revisions"."settings_json") AND length("site_settings_revisions"."settings_json") BETWEEN 2 AND 20000),
	CONSTRAINT "ck_site_settings_revisions_hash" CHECK(length("site_settings_revisions"."settings_hash") = 64 AND "site_settings_revisions"."settings_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "ck_site_settings_revisions_note" CHECK("site_settings_revisions"."change_note" IS NULL OR length("site_settings_revisions"."change_note") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_site_settings_revisions_request_key` ON `site_settings_revisions` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_site_settings_revisions_created` ON `site_settings_revisions` (`created_at`,`id`);--> statement-breakpoint

CREATE TRIGGER `trg_site_settings_revisions_immutable_update`
BEFORE UPDATE ON `site_settings_revisions`
BEGIN
  SELECT RAISE(ABORT, 'site settings revisions are append-only');
END;--> statement-breakpoint

CREATE TRIGGER `trg_site_settings_revisions_no_delete`
BEFORE DELETE ON `site_settings_revisions`
BEGIN
  SELECT RAISE(ABORT, 'site settings revisions cannot be deleted');
END;--> statement-breakpoint

CREATE TRIGGER `trg_site_settings_publications_immutable_update`
BEFORE UPDATE ON `site_settings_publication_events`
BEGIN
  SELECT RAISE(ABORT, 'site settings publication events are append-only');
END;--> statement-breakpoint

CREATE TRIGGER `trg_site_settings_publications_no_delete`
BEFORE DELETE ON `site_settings_publication_events`
BEGIN
  SELECT RAISE(ABORT, 'site settings publication events cannot be deleted');
END;
