CREATE INDEX `idx_companies_display_name_code` ON `companies` (`display_name`,`code`);--> statement-breakpoint
CREATE INDEX `idx_companies_status_code` ON `companies` (`status`,`code`);--> statement-breakpoint
CREATE INDEX `idx_companies_status_display_name_code` ON `companies` (`status`,`display_name`,`code`);--> statement-breakpoint
CREATE INDEX `idx_transport_jobs_created_id` ON `transport_jobs` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_transport_jobs_company_created_id` ON `transport_jobs` (`company_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_users_status_display_name_id` ON `users` (`status`,`display_name`,`id`);--> statement-breakpoint
CREATE INDEX `idx_users_status_email_id` ON `users` (`status`,`email`,`id`);