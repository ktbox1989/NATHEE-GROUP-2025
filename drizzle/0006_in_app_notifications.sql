CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`company_id` text NOT NULL,
	`source_event_id` text NOT NULL,
	`type` text NOT NULL,
	`severity` text DEFAULT 'INFO' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`href` text NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`source_event_id`) REFERENCES `status_events`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_notifications_type" CHECK("notifications"."type" IN ('MOTORCYCLE_STATUS_CHANGED')),
	CONSTRAINT "ck_notifications_severity" CHECK("notifications"."severity" IN ('INFO', 'WARNING', 'CRITICAL')),
	CONSTRAINT "ck_notifications_title" CHECK(length("notifications"."title") BETWEEN 1 AND 160),
	CONSTRAINT "ck_notifications_body" CHECK(length("notifications"."body") BETWEEN 1 AND 500),
	CONSTRAINT "ck_notifications_href" CHECK(length("notifications"."href") BETWEEN 6 AND 500 AND "notifications"."href" LIKE '/app/%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_notifications_idempotency_key` ON `notifications` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_notifications_recipient_created` ON `notifications` (`recipient_user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_notifications_recipient_unread` ON `notifications` (`recipient_user_id`,`created_at`) WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_notifications_source_event` ON `notifications` (`source_event_id`);