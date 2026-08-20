CREATE TABLE `quote_request_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_request_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`original_filename` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`checksum` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`quote_request_id`) REFERENCES `quote_requests`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_quote_request_attachments_filename" CHECK(length("quote_request_attachments"."original_filename") BETWEEN 1 AND 160),
	CONSTRAINT "ck_quote_request_attachments_content_type" CHECK("quote_request_attachments"."content_type" IN ('application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif')),
	CONSTRAINT "ck_quote_request_attachments_size" CHECK("quote_request_attachments"."byte_size" BETWEEN 1 AND 8388608),
	CONSTRAINT "ck_quote_request_attachments_checksum" CHECK(length("quote_request_attachments"."checksum") = 64 AND "quote_request_attachments"."checksum" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_quote_request_attachments_storage_key` ON `quote_request_attachments` (`storage_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_quote_request_attachments_quote_checksum` ON `quote_request_attachments` (`quote_request_id`,`checksum`);--> statement-breakpoint
CREATE INDEX `idx_quote_request_attachments_quote_created` ON `quote_request_attachments` (`quote_request_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TRIGGER `trg_quote_request_attachments_no_delete`
BEFORE DELETE ON `quote_request_attachments`
BEGIN
  SELECT RAISE(ABORT, 'quotation attachments cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `trg_quote_request_attachments_immutable`
BEFORE UPDATE ON `quote_request_attachments`
BEGIN
  SELECT RAISE(ABORT, 'quotation attachments are immutable');
END;
