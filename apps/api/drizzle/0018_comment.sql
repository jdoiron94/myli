CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body_md` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comment_recipe_id_created_at_idx` ON `comment` (`recipe_id`,`created_at`);