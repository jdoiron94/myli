CREATE TABLE `recipe_draft` (
	`recipe_id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`revision` integer NOT NULL,
	`author_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
