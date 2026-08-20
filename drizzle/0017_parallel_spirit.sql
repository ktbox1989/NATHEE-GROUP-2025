CREATE TABLE `motorcycle_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`job_id` text NOT NULL,
	`company_id` text NOT NULL,
	`source_filename` text NOT NULL,
	`source_type` text NOT NULL,
	`checksum` text NOT NULL,
	`row_count` integer NOT NULL,
	`valid_count` integer NOT NULL,
	`error_count` integer NOT NULL,
	`status` text DEFAULT 'VALIDATED' NOT NULL,
	`import_request_key` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`imported_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `transport_jobs`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_motorcycle_import_batches_filename" CHECK(length("motorcycle_import_batches"."source_filename") BETWEEN 1 AND 160),
	CONSTRAINT "ck_motorcycle_import_batches_type" CHECK("motorcycle_import_batches"."source_type" IN ('CSV', 'XLSX')),
	CONSTRAINT "ck_motorcycle_import_batches_checksum" CHECK(length("motorcycle_import_batches"."checksum") = 64 AND "motorcycle_import_batches"."checksum" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "ck_motorcycle_import_batches_counts" CHECK("motorcycle_import_batches"."row_count" BETWEEN 1 AND 500 AND "motorcycle_import_batches"."valid_count" >= 0 AND "motorcycle_import_batches"."error_count" >= 0 AND "motorcycle_import_batches"."valid_count" + "motorcycle_import_batches"."error_count" = "motorcycle_import_batches"."row_count"),
	CONSTRAINT "ck_motorcycle_import_batches_status" CHECK("motorcycle_import_batches"."status" IN ('VALIDATED', 'IMPORTING', 'IMPORTED', 'FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_import_batches_request_key` ON `motorcycle_import_batches` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_import_batches_job_checksum` ON `motorcycle_import_batches` (`job_id`,`checksum`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_import_batches_import_request` ON `motorcycle_import_batches` (`import_request_key`) WHERE "motorcycle_import_batches"."import_request_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_motorcycle_import_batches_job_created` ON `motorcycle_import_batches` (`job_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_motorcycle_import_batches_company_created` ON `motorcycle_import_batches` (`company_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `motorcycle_import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`source_row_number` integer NOT NULL,
	`record_id` text NOT NULL,
	`public_id` text NOT NULL,
	`raw_payload` text NOT NULL,
	`make` text,
	`model` text,
	`variant` text,
	`model_year` integer,
	`color` text,
	`registration` text,
	`province` text,
	`vin` text,
	`engine_number` text,
	`vehicle_condition` text DEFAULT 'UNKNOWN' NOT NULL,
	`notes` text,
	`validation_status` text NOT NULL,
	`error_message` text,
	`imported_record_id` text,
	`imported_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `motorcycle_import_batches`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`imported_record_id`) REFERENCES `motorcycles`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_motorcycle_import_rows_source_row" CHECK("motorcycle_import_rows"."source_row_number" BETWEEN 2 AND 501),
	CONSTRAINT "ck_motorcycle_import_rows_condition" CHECK("motorcycle_import_rows"."vehicle_condition" IN ('NEW', 'USED', 'UNKNOWN')),
	CONSTRAINT "ck_motorcycle_import_rows_validation" CHECK("motorcycle_import_rows"."validation_status" IN ('VALID', 'ERROR', 'IMPORTED')),
	CONSTRAINT "ck_motorcycle_import_rows_import_marker" CHECK(("motorcycle_import_rows"."validation_status" = 'IMPORTED' AND "motorcycle_import_rows"."imported_record_id" IS NOT NULL AND "motorcycle_import_rows"."imported_at" IS NOT NULL) OR ("motorcycle_import_rows"."validation_status" <> 'IMPORTED' AND "motorcycle_import_rows"."imported_record_id" IS NULL AND "motorcycle_import_rows"."imported_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_import_rows_batch_row` ON `motorcycle_import_rows` (`batch_id`,`source_row_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_import_rows_record_id` ON `motorcycle_import_rows` (`record_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_import_rows_public_id` ON `motorcycle_import_rows` (`public_id`);--> statement-breakpoint
CREATE INDEX `idx_motorcycle_import_rows_batch_status_row` ON `motorcycle_import_rows` (`batch_id`,`validation_status`,`source_row_number`);--> statement-breakpoint
ALTER TABLE `motorcycles` ADD COLUMN `variant` text;--> statement-breakpoint
ALTER TABLE `motorcycles` ADD COLUMN `model_year` integer CHECK (`model_year` IS NULL OR `model_year` BETWEEN 1900 AND 2200);--> statement-breakpoint
ALTER TABLE `motorcycles` ADD COLUMN `province` text;--> statement-breakpoint
ALTER TABLE `motorcycles` ADD COLUMN `vehicle_condition` text NOT NULL DEFAULT 'UNKNOWN' CHECK (`vehicle_condition` IN ('NEW', 'USED', 'UNKNOWN'));--> statement-breakpoint
ALTER TABLE `motorcycles` ADD COLUMN `notes` text CHECK (`notes` IS NULL OR length(`notes`) <= 1000);--> statement-breakpoint
INSERT INTO `sequence_counters` (`name`, `value`, `updated_at`)
SELECT 'motorcycle:' || `job_id`, max(`sequence_number`), CURRENT_TIMESTAMP
FROM `motorcycles`
GROUP BY `job_id`
ON CONFLICT(`name`) DO UPDATE SET
  `value` = max(`sequence_counters`.`value`, excluded.`value`),
  `updated_at` = CURRENT_TIMESTAMP;--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_import_batches_no_delete`
BEFORE DELETE ON `motorcycle_import_batches`
BEGIN
  SELECT RAISE(ABORT, 'motorcycle import batches cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_import_batches_identity_immutable`
BEFORE UPDATE ON `motorcycle_import_batches`
WHEN NEW.id <> OLD.id OR NEW.request_key <> OLD.request_key OR NEW.job_id <> OLD.job_id
  OR NEW.company_id <> OLD.company_id OR NEW.source_filename <> OLD.source_filename
  OR NEW.source_type <> OLD.source_type OR NEW.checksum <> OLD.checksum
  OR NEW.row_count <> OLD.row_count OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'motorcycle import batch identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_import_batches_transition`
BEFORE UPDATE OF status ON `motorcycle_import_batches`
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'VALIDATED' AND NEW.status = 'IMPORTING' AND OLD.error_count = 0 AND NEW.import_request_key IS NOT NULL AND NEW.imported_at IS NULL)
  OR (OLD.status = 'IMPORTING' AND NEW.status = 'IMPORTED' AND NEW.import_request_key = OLD.import_request_key AND NEW.imported_at IS NOT NULL)
  OR (OLD.status IN ('VALIDATED', 'IMPORTING') AND NEW.status = 'FAILED' AND NEW.imported_at IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid motorcycle import batch transition');
END;--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_import_rows_no_delete`
BEFORE DELETE ON `motorcycle_import_rows`
BEGIN
  SELECT RAISE(ABORT, 'motorcycle import rows cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_import_rows_identity_immutable`
BEFORE UPDATE ON `motorcycle_import_rows`
WHEN NEW.id <> OLD.id OR NEW.batch_id <> OLD.batch_id OR NEW.source_row_number <> OLD.source_row_number
  OR NEW.record_id <> OLD.record_id OR NEW.public_id <> OLD.public_id OR NEW.raw_payload <> OLD.raw_payload
  OR NEW.make IS NOT OLD.make OR NEW.model IS NOT OLD.model OR NEW.variant IS NOT OLD.variant
  OR NEW.model_year IS NOT OLD.model_year OR NEW.color IS NOT OLD.color OR NEW.registration IS NOT OLD.registration
  OR NEW.province IS NOT OLD.province OR NEW.vin IS NOT OLD.vin OR NEW.engine_number IS NOT OLD.engine_number
  OR NEW.vehicle_condition <> OLD.vehicle_condition OR NEW.notes IS NOT OLD.notes OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'motorcycle import row identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_import_rows_transition`
BEFORE UPDATE OF validation_status, imported_record_id, imported_at ON `motorcycle_import_rows`
WHEN NOT (
  (OLD.validation_status = 'VALID' AND NEW.validation_status = 'ERROR' AND NEW.imported_record_id IS NULL AND NEW.imported_at IS NULL)
  OR (OLD.validation_status = 'ERROR' AND NEW.validation_status = 'ERROR' AND NEW.imported_record_id IS NULL AND NEW.imported_at IS NULL)
  OR (OLD.validation_status = 'VALID' AND NEW.validation_status = 'IMPORTED' AND NEW.imported_record_id = OLD.record_id AND NEW.imported_at IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid motorcycle import row transition');
END;
