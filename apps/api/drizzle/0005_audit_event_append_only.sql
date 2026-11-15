-- The audit log is append-only (spec §3.1). These triggers refuse every change to a recorded
-- event, whatever code runs. Rebuilding the table drops them: a migration that does must create
-- them again (audit.test.ts checks they exist).
CREATE TRIGGER `audit_event_no_update` BEFORE UPDATE ON `audit_event`
BEGIN
	SELECT RAISE(ABORT, 'audit_event is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_event_no_delete` BEFORE DELETE ON `audit_event`
BEGIN
	SELECT RAISE(ABORT, 'audit_event is append-only');
END;
