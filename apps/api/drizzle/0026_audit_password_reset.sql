PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_event_action_check" CHECK("__new_audit_event"."action" in ('setup.completed', 'invitation.created', 'invitation.resent', 'invitation.revoked', 'invitation.accepted', 'user.role_changed', 'user.deactivated', 'user.reactivated', 'sign_in.succeeded', 'sign_in.failed', 'sign_out.succeeded', 'email.verified', 'password.changed', 'password.reset', 'recipe.deleted', 'recipe.restored', 'recipe.purged', 'revision.restored', 'comment.deleted', 'public_link.created', 'public_link.revoked', 'tag.renamed', 'tag.merged', 'tag.deleted', 'instance.exported')),
	CONSTRAINT "audit_event_target_type_check" CHECK("__new_audit_event"."target_type" is null or "__new_audit_event"."target_type" in ('invitation', 'user', 'recipe', 'tag')),
	CONSTRAINT "audit_event_target_check" CHECK(("__new_audit_event"."target_type" is null) = ("__new_audit_event"."target_id" is null))
);
--> statement-breakpoint
INSERT INTO `__new_audit_event`("id", "actor_id", "action", "target_type", "target_id", "metadata", "ip", "user_agent", "created_at") SELECT "id", "actor_id", "action", "target_type", "target_id", "metadata", "ip", "user_agent", "created_at" FROM `audit_event`;--> statement-breakpoint
DROP TABLE `audit_event`;--> statement-breakpoint
ALTER TABLE `__new_audit_event` RENAME TO `audit_event`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_event_action_idx` ON `audit_event` (`action`,`id`);--> statement-breakpoint
-- Rebuilding the table dropped the append-only triggers (0005): create them again.
CREATE TRIGGER `audit_event_no_update` BEFORE UPDATE ON `audit_event`
BEGIN
	SELECT RAISE(ABORT, 'audit_event is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_event_no_delete` BEFORE DELETE ON `audit_event`
BEGIN
	SELECT RAISE(ABORT, 'audit_event is append-only');
END;
