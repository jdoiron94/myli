CREATE TABLE `user_preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`unit_system` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_preference_unit_system_check" CHECK("user_preference"."unit_system" in ('imperial', 'metric'))
);
