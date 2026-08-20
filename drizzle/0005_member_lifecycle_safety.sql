ALTER TABLE `users` ADD `management_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_management_request_id` text;--> statement-breakpoint
CREATE TRIGGER `trg_user_roles_keep_last_active_owner_delete`
BEFORE DELETE ON `user_role_assignments`
FOR EACH ROW
WHEN OLD.`role` = 'OWNER'
AND EXISTS (
	SELECT 1 FROM `users` WHERE `id` = OLD.`user_id` AND `status` = 'ACTIVE'
)
AND (
	SELECT COUNT(*)
	FROM `users` u
	LEFT JOIN `user_role_assignments` r ON r.`user_id` = u.`id`
	WHERE u.`status` = 'ACTIVE'
	AND COALESCE(r.`role`, CASE u.`role` WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END) = 'OWNER'
) <= 1
BEGIN
	SELECT RAISE(ABORT, 'cannot remove the final active owner');
END;--> statement-breakpoint
CREATE TRIGGER `trg_user_roles_keep_last_active_owner_update`
BEFORE UPDATE OF `role` ON `user_role_assignments`
FOR EACH ROW
WHEN OLD.`role` = 'OWNER' AND NEW.`role` <> 'OWNER'
AND EXISTS (
	SELECT 1 FROM `users` WHERE `id` = OLD.`user_id` AND `status` = 'ACTIVE'
)
AND (
	SELECT COUNT(*)
	FROM `users` u
	LEFT JOIN `user_role_assignments` r ON r.`user_id` = u.`id`
	WHERE u.`status` = 'ACTIVE'
	AND COALESCE(r.`role`, CASE u.`role` WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END) = 'OWNER'
) <= 1
BEGIN
	SELECT RAISE(ABORT, 'cannot remove the final active owner');
END;--> statement-breakpoint
CREATE TRIGGER `trg_users_keep_last_active_owner_status`
BEFORE UPDATE OF `status` ON `users`
FOR EACH ROW
WHEN OLD.`status` = 'ACTIVE' AND NEW.`status` <> 'ACTIVE'
AND COALESCE(
	(SELECT `role` FROM `user_role_assignments` WHERE `user_id` = OLD.`id`),
	CASE OLD.`role` WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END
) = 'OWNER'
AND (
	SELECT COUNT(*)
	FROM `users` u
	LEFT JOIN `user_role_assignments` r ON r.`user_id` = u.`id`
	WHERE u.`status` = 'ACTIVE'
	AND COALESCE(r.`role`, CASE u.`role` WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END) = 'OWNER'
) <= 1
BEGIN
	SELECT RAISE(ABORT, 'cannot deactivate the final active owner');
END;--> statement-breakpoint
CREATE TRIGGER `trg_users_keep_last_active_owner_legacy_role`
BEFORE UPDATE OF `role` ON `users`
FOR EACH ROW
WHEN OLD.`status` = 'ACTIVE' AND OLD.`role` = 'OWNER' AND NEW.`role` <> 'OWNER'
AND NOT EXISTS (SELECT 1 FROM `user_role_assignments` WHERE `user_id` = OLD.`id`)
AND (
	SELECT COUNT(*)
	FROM `users` u
	LEFT JOIN `user_role_assignments` r ON r.`user_id` = u.`id`
	WHERE u.`status` = 'ACTIVE'
	AND COALESCE(r.`role`, CASE u.`role` WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END) = 'OWNER'
) <= 1
BEGIN
	SELECT RAISE(ABORT, 'cannot demote the final active owner');
END;
