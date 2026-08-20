CREATE TABLE `user_role_assignments` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`assigned_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_user_role_assignments_role" CHECK("user_role_assignments"."role" IN ('OWNER', 'ADMIN', 'STAFF', 'SALE', 'WAREHOUSE', 'CHECKER', 'DRIVER', 'ACCOUNTING', 'CUSTOMER_ADMIN', 'CUSTOMER_VIEWER'))
);
--> statement-breakpoint
CREATE INDEX `idx_user_role_assignments_role` ON `user_role_assignments` (`role`);
--> statement-breakpoint
INSERT INTO `user_role_assignments` (`user_id`, `role`, `assigned_by`)
SELECT
	`id`,
	CASE `role`
		WHEN 'OWNER' THEN 'OWNER'
		WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER'
		ELSE 'STAFF'
	END,
	NULL
FROM `users`;
--> statement-breakpoint
CREATE TRIGGER `trg_user_role_assignments_compatible_insert`
BEFORE INSERT ON `user_role_assignments`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM `users`
	WHERE `id` = NEW.`user_id`
	AND (
		(NEW.`role` = 'OWNER' AND `role` = 'OWNER')
		OR (NEW.`role` IN ('CUSTOMER_ADMIN', 'CUSTOMER_VIEWER') AND `role` = 'CUSTOMER' AND `company_id` IS NOT NULL)
		OR (NEW.`role` IN ('ADMIN', 'STAFF', 'SALE', 'WAREHOUSE', 'CHECKER', 'DRIVER', 'ACCOUNTING') AND `role` = 'STAFF')
	)
)
BEGIN
	SELECT RAISE(ABORT, 'incompatible user role assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_user_role_assignments_compatible_update`
BEFORE UPDATE OF `role` ON `user_role_assignments`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1 FROM `users`
	WHERE `id` = NEW.`user_id`
	AND (
		(NEW.`role` = 'OWNER' AND `role` = 'OWNER')
		OR (NEW.`role` IN ('CUSTOMER_ADMIN', 'CUSTOMER_VIEWER') AND `role` = 'CUSTOMER' AND `company_id` IS NOT NULL)
		OR (NEW.`role` IN ('ADMIN', 'STAFF', 'SALE', 'WAREHOUSE', 'CHECKER', 'DRIVER', 'ACCOUNTING') AND `role` = 'STAFF')
	)
)
BEGIN
	SELECT RAISE(ABORT, 'incompatible user role assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_users_role_assignment_compatible_update`
BEFORE UPDATE OF `role`, `company_id` ON `users`
FOR EACH ROW
WHEN EXISTS (
	SELECT 1 FROM `user_role_assignments`
	WHERE `user_id` = NEW.`id`
	AND NOT (
		(`role` = 'OWNER' AND NEW.`role` = 'OWNER')
		OR (`role` IN ('CUSTOMER_ADMIN', 'CUSTOMER_VIEWER') AND NEW.`role` = 'CUSTOMER' AND NEW.`company_id` IS NOT NULL)
		OR (`role` IN ('ADMIN', 'STAFF', 'SALE', 'WAREHOUSE', 'CHECKER', 'DRIVER', 'ACCOUNTING') AND NEW.`role` = 'STAFF')
	)
)
BEGIN
	SELECT RAISE(ABORT, 'incompatible legacy user role');
END;
