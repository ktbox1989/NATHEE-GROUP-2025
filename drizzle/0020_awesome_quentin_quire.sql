CREATE TABLE `motorcycle_image_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`motorcycle_image_id` text NOT NULL,
	`role` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`checksum` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`motorcycle_image_id`) REFERENCES `motorcycle_images`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_motorcycle_image_variants_role" CHECK("motorcycle_image_variants"."role" IN ('DISPLAY', 'THUMBNAIL')),
	CONSTRAINT "ck_motorcycle_image_variants_content_type" CHECK("motorcycle_image_variants"."content_type" IN ('image/webp', 'image/avif')),
	CONSTRAINT "ck_motorcycle_image_variants_width" CHECK("motorcycle_image_variants"."width" BETWEEN 1 AND 50000),
	CONSTRAINT "ck_motorcycle_image_variants_height" CHECK("motorcycle_image_variants"."height" BETWEEN 1 AND 50000),
	CONSTRAINT "ck_motorcycle_image_variants_size" CHECK("motorcycle_image_variants"."byte_size" > 0),
	CONSTRAINT "ck_motorcycle_image_variants_checksum" CHECK(length("motorcycle_image_variants"."checksum") = 64 AND "motorcycle_image_variants"."checksum" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_image_variants_storage_key` ON `motorcycle_image_variants` (`storage_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_image_variants_image_role_type` ON `motorcycle_image_variants` (`motorcycle_image_id`,`role`,`content_type`);--> statement-breakpoint
CREATE INDEX `idx_motorcycle_image_variants_image_role` ON `motorcycle_image_variants` (`motorcycle_image_id`,`role`);--> statement-breakpoint
ALTER TABLE `motorcycle_images` ADD `request_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_motorcycle_images_request_key` ON `motorcycle_images` (`request_key`);
--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_images_no_delete`
BEFORE DELETE ON `motorcycle_images`
BEGIN
  SELECT RAISE(ABORT, 'motorcycle evidence images cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_images_immutable`
BEFORE UPDATE ON `motorcycle_images`
BEGIN
  SELECT RAISE(ABORT, 'motorcycle evidence images are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_image_variants_no_delete`
BEFORE DELETE ON `motorcycle_image_variants`
BEGIN
  SELECT RAISE(ABORT, 'motorcycle evidence image variants cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_motorcycle_image_variants_immutable`
BEFORE UPDATE ON `motorcycle_image_variants`
BEGIN
  SELECT RAISE(ABORT, 'motorcycle evidence image variants are immutable');
END;
