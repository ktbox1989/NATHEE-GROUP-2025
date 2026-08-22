CREATE TRIGGER `trg_audit_logs_no_update`
BEFORE UPDATE ON `audit_logs`
BEGIN
	SELECT RAISE(ABORT, 'audit entries cannot be modified');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_audit_logs_no_delete`
BEFORE DELETE ON `audit_logs`
BEGIN
	SELECT RAISE(ABORT, 'audit entries cannot be deleted');
END;
