ALTER TABLE `motorcycle_inspections` ADD `left_image_id` text REFERENCES `motorcycle_images`(`id`) ON UPDATE cascade ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `motorcycle_inspections` ADD `right_image_id` text REFERENCES `motorcycle_images`(`id`) ON UPDATE cascade ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `motorcycle_inspections` ADD `front_image_id` text REFERENCES `motorcycle_images`(`id`) ON UPDATE cascade ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `motorcycle_inspections` ADD `rear_image_id` text REFERENCES `motorcycle_images`(`id`) ON UPDATE cascade ON DELETE restrict;
--> statement-breakpoint
CREATE TRIGGER `trg_receipt_inspections_require_four_angles`
BEFORE INSERT ON `motorcycle_inspections`
WHEN NEW.`type` = 'RECEIPT'
AND EXISTS (
  SELECT 1 FROM `motorcycles` motorcycle
  WHERE motorcycle.`id` = NEW.`motorcycle_id`
    AND motorcycle.`company_id` = NEW.`company_id`
)
AND (
  NEW.`left_image_id` IS NULL
  OR NEW.`right_image_id` IS NULL
  OR NEW.`front_image_id` IS NULL
  OR NEW.`rear_image_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `motorcycle_images` image
    WHERE image.`id` = NEW.`left_image_id`
      AND image.`motorcycle_id` = NEW.`motorcycle_id`
      AND image.`company_id` = NEW.`company_id`
      AND image.`category` = 'LEFT'
  )
  OR NOT EXISTS (
    SELECT 1 FROM `motorcycle_images` image
    WHERE image.`id` = NEW.`right_image_id`
      AND image.`motorcycle_id` = NEW.`motorcycle_id`
      AND image.`company_id` = NEW.`company_id`
      AND image.`category` = 'RIGHT'
  )
  OR NOT EXISTS (
    SELECT 1 FROM `motorcycle_images` image
    WHERE image.`id` = NEW.`front_image_id`
      AND image.`motorcycle_id` = NEW.`motorcycle_id`
      AND image.`company_id` = NEW.`company_id`
      AND image.`category` = 'FRONT'
  )
  OR NOT EXISTS (
    SELECT 1 FROM `motorcycle_images` image
    WHERE image.`id` = NEW.`rear_image_id`
      AND image.`motorcycle_id` = NEW.`motorcycle_id`
      AND image.`company_id` = NEW.`company_id`
      AND image.`category` = 'REAR'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'receipt inspection requires matching left, right, front and rear motorcycle evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_motorcycles_require_receipt_evidence`
BEFORE UPDATE OF `current_status` ON `motorcycles`
WHEN NEW.`current_status` IN ('RECEIVED', 'INSPECTED')
AND NOT EXISTS (
  SELECT 1 FROM `motorcycle_inspections` inspection
  WHERE inspection.`motorcycle_id` = NEW.`id`
    AND inspection.`company_id` = NEW.`company_id`
    AND inspection.`type` = 'RECEIPT'
    AND inspection.`result` = 'PASS'
    AND inspection.`left_image_id` IS NOT NULL
    AND inspection.`right_image_id` IS NOT NULL
    AND inspection.`front_image_id` IS NOT NULL
    AND inspection.`rear_image_id` IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'motorcycle requires a passed receipt inspection with four-angle evidence');
END;
