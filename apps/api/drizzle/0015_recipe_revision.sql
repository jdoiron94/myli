CREATE TABLE `recipe_revision` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` text NOT NULL,
	`number` integer NOT NULL,
	`snapshot` text NOT NULL,
	`author_id` text NOT NULL,
	`message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_revision_number_idx` ON `recipe_revision` (`recipe_id`,`number`);