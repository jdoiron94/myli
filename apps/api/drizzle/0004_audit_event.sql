CREATE TABLE `audit_event` (
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
	CONSTRAINT "audit_event_action_check" CHECK("audit_event"."action" in ('setup.completed', 'invitation.created', 'invitation.resent', 'invitation.revoked', 'invitation.accepted', 'user.role_changed', 'user.deactivated', 'user.reactivated', 'sign_in.succeeded', 'sign_in.failed', 'sign_out.succeeded', 'recipe.deleted', 'recipe.restored', 'recipe.purged', 'revision.restored', 'public_link.created', 'public_link.revoked', 'instance.exported')),
	CONSTRAINT "audit_event_target_type_check" CHECK("audit_event"."target_type" is null or "audit_event"."target_type" in ('invitation', 'user', 'recipe')),
	CONSTRAINT "audit_event_target_check" CHECK(("audit_event"."target_type" is null) = ("audit_event"."target_id" is null))
);
--> statement-breakpoint
CREATE INDEX `audit_event_action_idx` ON `audit_event` (`action`,`id`);