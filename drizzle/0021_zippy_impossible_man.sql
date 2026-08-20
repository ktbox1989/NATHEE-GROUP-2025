ALTER TABLE `proof_of_delivery_records`
ADD COLUMN `signature_required` integer DEFAULT 0 NOT NULL
CHECK (`signature_required` IN (0, 1));
--> statement-breakpoint
CREATE TABLE `proof_of_delivery_signatures` (
	`id` text PRIMARY KEY NOT NULL,
	`pod_id` text NOT NULL,
	`company_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`checksum` text NOT NULL,
	`attested_by` text NOT NULL,
	`attested_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pod_id`) REFERENCES `proof_of_delivery_records`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`attested_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_pod_signatures_content_type" CHECK(`content_type` = 'image/png'),
	CONSTRAINT "ck_pod_signatures_dimensions" CHECK(`width` BETWEEN 200 AND 2048 AND `height` BETWEEN 80 AND 1024 AND `width` > `height`),
	CONSTRAINT "ck_pod_signatures_size" CHECK(`byte_size` BETWEEN 200 AND 1048576),
	CONSTRAINT "ck_pod_signatures_checksum" CHECK(length(`checksum`) = 64 AND `checksum` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pod_signatures_pod` ON `proof_of_delivery_signatures` (`pod_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pod_signatures_storage_key` ON `proof_of_delivery_signatures` (`storage_key`);
--> statement-breakpoint
CREATE INDEX `idx_pod_signatures_company_created` ON `proof_of_delivery_signatures` (`company_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `trg_pod_records_require_signature_flag_insert`
BEFORE INSERT ON `proof_of_delivery_records`
FOR EACH ROW
WHEN NEW.`signature_required` <> 1
BEGIN
	SELECT RAISE(ABORT, 'new proof of delivery requires signature evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_pod_records_signature_required_immutable`
BEFORE UPDATE OF `signature_required` ON `proof_of_delivery_records`
FOR EACH ROW
WHEN NEW.`signature_required` <> OLD.`signature_required`
BEGIN
	SELECT RAISE(ABORT, 'proof of delivery signature requirement is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_pod_signatures_validate_insert`
BEFORE INSERT ON `proof_of_delivery_signatures`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM `proof_of_delivery_records`
	WHERE `id` = NEW.`pod_id`
	AND `company_id` = NEW.`company_id`
	AND `signature_required` = 1
)
BEGIN
	SELECT RAISE(ABORT, 'signature requires matching proof of delivery and company');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_pod_signatures_no_update`
BEFORE UPDATE ON `proof_of_delivery_signatures`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'proof of delivery signature is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_pod_signatures_no_delete`
BEFORE DELETE ON `proof_of_delivery_signatures`
FOR EACH ROW
BEGIN
	SELECT RAISE(ABORT, 'proof of delivery signature cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_motorcycles_require_new_pod_signature`
BEFORE UPDATE OF `current_status` ON `motorcycles`
FOR EACH ROW
WHEN NEW.`current_status` = 'DELIVERED'
AND EXISTS (
	SELECT 1 FROM `proof_of_delivery_records` pod
	WHERE pod.`motorcycle_id` = NEW.`id`
	AND pod.`company_id` = NEW.`company_id`
	AND pod.`status` = 'ACTIVE'
	AND pod.`signature_required` = 1
	AND NOT EXISTS (
		SELECT 1 FROM `proof_of_delivery_signatures` signature
		WHERE signature.`pod_id` = pod.`id`
		AND signature.`company_id` = pod.`company_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'motorcycle requires signed proof of delivery');
END;
