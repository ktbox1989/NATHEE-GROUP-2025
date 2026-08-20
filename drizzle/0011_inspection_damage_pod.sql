CREATE TABLE `inspection_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`inspection_id` text NOT NULL,
	`area` text NOT NULL,
	`severity` text NOT NULL,
	`description` text NOT NULL,
	`evidence_image_id` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`inspection_id`) REFERENCES `motorcycle_inspections`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`evidence_image_id`) REFERENCES `motorcycle_images`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_inspection_findings_area" CHECK(length("inspection_findings"."area") BETWEEN 1 AND 100),
	CONSTRAINT "ck_inspection_findings_severity" CHECK("inspection_findings"."severity" IN ('MINOR', 'MODERATE', 'MAJOR')),
	CONSTRAINT "ck_inspection_findings_description" CHECK(length("inspection_findings"."description") BETWEEN 3 AND 1000)
);
--> statement-breakpoint
CREATE INDEX `idx_inspection_findings_inspection_created` ON `inspection_findings` (`inspection_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_inspection_findings_evidence` ON `inspection_findings` (`evidence_image_id`);--> statement-breakpoint
CREATE TABLE `motorcycle_inspections` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`motorcycle_id` text NOT NULL,
	`company_id` text NOT NULL,
	`type` text NOT NULL,
	`result` text NOT NULL,
	`odometer_km` integer,
	`fuel_level` text DEFAULT 'UNKNOWN' NOT NULL,
	`notes` text,
	`inspected_by` text NOT NULL,
	`inspected_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`motorcycle_id`) REFERENCES `motorcycles`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`inspected_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_motorcycle_inspections_type" CHECK("motorcycle_inspections"."type" IN ('RECEIPT', 'PRE_LOAD', 'DELIVERY')),
	CONSTRAINT "ck_motorcycle_inspections_result" CHECK("motorcycle_inspections"."result" IN ('PASS', 'ISSUE', 'DAMAGE')),
	CONSTRAINT "ck_motorcycle_inspections_odometer" CHECK("motorcycle_inspections"."odometer_km" IS NULL OR "motorcycle_inspections"."odometer_km" BETWEEN 0 AND 10000000),
	CONSTRAINT "ck_motorcycle_inspections_fuel" CHECK("motorcycle_inspections"."fuel_level" IN ('UNKNOWN', 'EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTERS', 'FULL')),
	CONSTRAINT "ck_motorcycle_inspections_notes" CHECK("motorcycle_inspections"."notes" IS NULL OR length("motorcycle_inspections"."notes") <= 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_inspections_request_key` ON `motorcycle_inspections` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_motorcycle_inspections_motorcycle_type_at` ON `motorcycle_inspections` (`motorcycle_id`,`type`,`inspected_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_motorcycle_inspections_company_at` ON `motorcycle_inspections` (`company_id`,`inspected_at`);--> statement-breakpoint
CREATE TABLE `proof_of_delivery_records` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`motorcycle_id` text NOT NULL,
	`company_id` text NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_phone` text,
	`delivery_location` text NOT NULL,
	`delivered_at` text NOT NULL,
	`evidence_image_id` text NOT NULL,
	`notes` text,
	`received_by` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`void_reason` text,
	`voided_by` text,
	`voided_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`motorcycle_id`) REFERENCES `motorcycles`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`evidence_image_id`) REFERENCES `motorcycle_images`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_pod_records_recipient" CHECK(length("proof_of_delivery_records"."recipient_name") BETWEEN 1 AND 160),
	CONSTRAINT "ck_pod_records_phone" CHECK("proof_of_delivery_records"."recipient_phone" IS NULL OR length("proof_of_delivery_records"."recipient_phone") BETWEEN 6 AND 50),
	CONSTRAINT "ck_pod_records_location" CHECK(length("proof_of_delivery_records"."delivery_location") BETWEEN 2 AND 300),
	CONSTRAINT "ck_pod_records_notes" CHECK("proof_of_delivery_records"."notes" IS NULL OR length("proof_of_delivery_records"."notes") <= 2000),
	CONSTRAINT "ck_pod_records_status" CHECK("proof_of_delivery_records"."status" IN ('ACTIVE', 'VOIDED')),
	CONSTRAINT "ck_pod_records_void" CHECK(("proof_of_delivery_records"."status" = 'VOIDED') = ("proof_of_delivery_records"."void_reason" IS NOT NULL AND "proof_of_delivery_records"."voided_by" IS NOT NULL AND "proof_of_delivery_records"."voided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pod_records_request_key` ON `proof_of_delivery_records` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pod_records_motorcycle_active` ON `proof_of_delivery_records` (`motorcycle_id`) WHERE "proof_of_delivery_records"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX `idx_pod_records_motorcycle_created` ON `proof_of_delivery_records` (`motorcycle_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_pod_records_company_delivered` ON `proof_of_delivery_records` (`company_id`,`delivered_at`);--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_inspections_validate_insert`
BEFORE INSERT ON `motorcycle_inspections`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM `motorcycles`
	WHERE `id` = NEW.`motorcycle_id`
	AND `company_id` = NEW.`company_id`
	AND (
		(NEW.`type` = 'RECEIPT' AND `current_status` IN ('PENDING_RECEIPT', 'RECEIVED', 'ISSUE', 'DAMAGED'))
		OR (NEW.`type` = 'PRE_LOAD' AND `current_status` IN ('INSPECTED', 'IN_YARD', 'SCHEDULED', 'ISSUE', 'DAMAGED'))
		OR (NEW.`type` = 'DELIVERY' AND `current_status` IN ('ARRIVED', 'DELIVERED', 'ISSUE', 'DAMAGED'))
	)
)
OR (
	NEW.`result` IN ('ISSUE', 'DAMAGE')
	AND (NEW.`notes` IS NULL OR length(trim(NEW.`notes`)) < 3)
)
BEGIN
	SELECT RAISE(ABORT, 'inspection requires matching motorcycle/company/workflow and issue notes');
END;--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_inspections_no_update`
BEFORE UPDATE ON `motorcycle_inspections`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'inspection history is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_inspections_no_delete`
BEFORE DELETE ON `motorcycle_inspections`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'inspection history cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `trg_inspection_findings_validate_insert`
BEFORE INSERT ON `inspection_findings`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM `motorcycle_inspections`
	WHERE `id` = NEW.`inspection_id` AND `result` IN ('ISSUE', 'DAMAGE')
)
OR (
	NEW.`evidence_image_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `motorcycle_images` image
		JOIN `motorcycle_inspections` inspection ON inspection.`id` = NEW.`inspection_id`
		WHERE image.`id` = NEW.`evidence_image_id`
		AND image.`motorcycle_id` = inspection.`motorcycle_id`
		AND image.`company_id` = inspection.`company_id`
		AND image.`category` = 'DAMAGE'
	)
)
BEGIN
	SELECT RAISE(ABORT, 'inspection finding requires issue/damage inspection and matching DAMAGE evidence');
END;--> statement-breakpoint
CREATE TRIGGER `trg_inspection_findings_no_update`
BEFORE UPDATE ON `inspection_findings`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'inspection finding history is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `trg_inspection_findings_no_delete`
BEFORE DELETE ON `inspection_findings`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'inspection finding history cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `trg_pod_records_validate_insert`
BEFORE INSERT ON `proof_of_delivery_records`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM `motorcycles`
	WHERE `id` = NEW.`motorcycle_id`
	AND `company_id` = NEW.`company_id`
	AND `current_status` = 'ARRIVED'
)
OR NOT EXISTS (
	SELECT 1 FROM `motorcycle_images`
	WHERE `id` = NEW.`evidence_image_id`
	AND `motorcycle_id` = NEW.`motorcycle_id`
	AND `company_id` = NEW.`company_id`
	AND `category` = 'DELIVERY'
)
BEGIN
	SELECT RAISE(ABORT, 'proof of delivery requires arrived motorcycle and matching DELIVERY evidence');
END;--> statement-breakpoint
CREATE TRIGGER `trg_pod_records_identity_immutable`
BEFORE UPDATE OF `request_key`, `motorcycle_id`, `company_id`, `recipient_name`, `recipient_phone`, `delivery_location`, `delivered_at`, `evidence_image_id`, `notes`, `received_by`, `created_at`
ON `proof_of_delivery_records`
FOR EACH ROW
WHEN NEW.`request_key` <> OLD.`request_key`
OR NEW.`motorcycle_id` <> OLD.`motorcycle_id`
OR NEW.`company_id` <> OLD.`company_id`
OR NEW.`recipient_name` <> OLD.`recipient_name`
OR NEW.`recipient_phone` IS NOT OLD.`recipient_phone`
OR NEW.`delivery_location` <> OLD.`delivery_location`
OR NEW.`delivered_at` <> OLD.`delivered_at`
OR NEW.`evidence_image_id` <> OLD.`evidence_image_id`
OR NEW.`notes` IS NOT OLD.`notes`
OR NEW.`received_by` <> OLD.`received_by`
OR NEW.`created_at` <> OLD.`created_at`
BEGIN
	SELECT RAISE(ABORT, 'proof of delivery identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `trg_pod_records_validate_void`
BEFORE UPDATE OF `status` ON `proof_of_delivery_records`
FOR EACH ROW
WHEN OLD.`status` <> 'ACTIVE'
OR NEW.`status` <> 'VOIDED'
OR NEW.`void_reason` IS NULL
OR length(trim(NEW.`void_reason`)) < 3
OR NEW.`voided_by` IS NULL
OR NEW.`voided_at` IS NULL
OR NOT EXISTS (
	SELECT 1 FROM `motorcycles`
	WHERE `id` = OLD.`motorcycle_id` AND `current_status` = 'ARRIVED'
)
BEGIN
	SELECT RAISE(ABORT, 'active proof may be voided with reason only before motorcycle delivery');
END;--> statement-breakpoint
CREATE TRIGGER `trg_pod_records_no_delete`
BEFORE DELETE ON `proof_of_delivery_records`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'proof of delivery history cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `trg_motorcycles_require_receipt_inspection`
BEFORE UPDATE OF `current_status` ON `motorcycles`
FOR EACH ROW
WHEN NEW.`current_status` = 'INSPECTED'
AND NOT EXISTS (
	SELECT 1 FROM `motorcycle_inspections`
	WHERE `motorcycle_id` = NEW.`id`
	AND `company_id` = NEW.`company_id`
	AND `type` = 'RECEIPT'
	AND `result` = 'PASS'
)
BEGIN
	SELECT RAISE(ABORT, 'motorcycle requires a passed receipt inspection');
END;--> statement-breakpoint
CREATE TRIGGER `trg_motorcycles_require_active_pod`
BEFORE UPDATE OF `current_status` ON `motorcycles`
FOR EACH ROW
WHEN NEW.`current_status` = 'DELIVERED'
AND NOT EXISTS (
	SELECT 1 FROM `proof_of_delivery_records`
	WHERE `motorcycle_id` = NEW.`id`
	AND `company_id` = NEW.`company_id`
	AND `status` = 'ACTIVE'
)
BEGIN
	SELECT RAISE(ABORT, 'motorcycle requires active proof of delivery');
END;
