CREATE TABLE `auth_recovery_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`external_auth_id` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	CONSTRAINT "ck_auth_recovery_grants_id" CHECK(length("auth_recovery_grants"."id") = 64 AND "auth_recovery_grants"."id" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "ck_auth_recovery_grants_identity" CHECK(length("auth_recovery_grants"."external_auth_id") = 36 AND "auth_recovery_grants"."external_auth_id" GLOB '[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*'),
	CONSTRAINT "ck_auth_recovery_grants_clock" CHECK("auth_recovery_grants"."issued_at" > 0 AND "auth_recovery_grants"."expires_at" > "auth_recovery_grants"."issued_at" AND ("auth_recovery_grants"."consumed_at" IS NULL OR "auth_recovery_grants"."consumed_at" >= "auth_recovery_grants"."issued_at"))
);
--> statement-breakpoint
CREATE INDEX `idx_auth_recovery_grants_expires` ON `auth_recovery_grants` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_auth_recovery_grants_identity` ON `auth_recovery_grants` (`external_auth_id`,`expires_at`);