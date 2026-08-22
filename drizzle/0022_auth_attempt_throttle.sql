CREATE TABLE `auth_attempt_counters` (
	`scope` text NOT NULL,
	`scope_key` text NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL,
	`locked_until` integer,
	`lockout_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `scope_key`),
	CONSTRAINT "ck_auth_attempt_counters_scope" CHECK("auth_attempt_counters"."scope" IN ('login:identity', 'login:client', 'recovery:identity', 'recovery:client')),
	CONSTRAINT "ck_auth_attempt_counters_scope_key" CHECK(length("auth_attempt_counters"."scope_key") = 64 AND "auth_attempt_counters"."scope_key" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "ck_auth_attempt_counters_counts" CHECK("auth_attempt_counters"."failure_count" >= 0 AND "auth_attempt_counters"."lockout_count" >= 0),
	CONSTRAINT "ck_auth_attempt_counters_clock" CHECK("auth_attempt_counters"."window_started_at" > 0 AND "auth_attempt_counters"."updated_at" > 0 AND ("auth_attempt_counters"."locked_until" IS NULL OR "auth_attempt_counters"."locked_until" > 0))
);
--> statement-breakpoint
CREATE INDEX `idx_auth_attempt_counters_updated` ON `auth_attempt_counters` (`updated_at`);