DROP INDEX `collection_owner_name_key_idx`;--> statement-breakpoint
CREATE INDEX `collection_owner_name_key_idx` ON `collection` (`owner_id`,`name_key`);