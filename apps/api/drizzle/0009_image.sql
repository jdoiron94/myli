CREATE TABLE `image` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text,
	`uploader_id` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`variants` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploader_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "image_mime_check" CHECK("image"."mime" in ('image/jpeg', 'image/png', 'image/webp'))
);
--> statement-breakpoint
CREATE INDEX `image_recipe_idx` ON `image` (`recipe_id`);