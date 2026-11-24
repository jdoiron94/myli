CREATE TABLE `rating` (
	`user_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`stars` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `recipe_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rating_stars_check" CHECK("rating"."stars" between 1 and 5)
);
--> statement-breakpoint
CREATE INDEX `rating_recipe_id_idx` ON `rating` (`recipe_id`);