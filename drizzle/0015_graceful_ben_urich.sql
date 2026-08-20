ALTER TABLE `quote_requests` ADD `request_key` text;--> statement-breakpoint
ALTER TABLE `quote_requests` ADD `source` text DEFAULT 'LEGACY' NOT NULL;--> statement-breakpoint
ALTER TABLE `quote_requests` ADD `consent_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_quote_requests_request_key` ON `quote_requests` (`request_key`) WHERE "quote_requests"."request_key" IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER `trg_quote_requests_no_delete`
BEFORE DELETE ON `quote_requests`
BEGIN
  SELECT RAISE(ABORT, 'quote requests cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `trg_quote_requests_public_requirements`
BEFORE INSERT ON `quote_requests`
WHEN NEW.source NOT IN ('LEGACY', 'PUBLIC_WEBSITE', 'INTERNAL')
  OR (NEW.source = 'PUBLIC_WEBSITE' AND (NEW.request_key IS NULL OR NEW.consent_at IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'invalid quotation source or missing public consent');
END;--> statement-breakpoint
CREATE TRIGGER `trg_quote_requests_identity_immutable`
BEFORE UPDATE OF request_key, source, consent_at ON `quote_requests`
WHEN NOT (NEW.request_key IS OLD.request_key AND NEW.source = OLD.source AND NEW.consent_at IS OLD.consent_at)
BEGIN
  SELECT RAISE(ABORT, 'quotation submission identity is immutable');
END;
