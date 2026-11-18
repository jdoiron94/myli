ALTER TABLE `image` ADD `position` integer;--> statement-breakpoint
ALTER TABLE `recipe` ADD `cover_image_id` text REFERENCES image(id);--> statement-breakpoint
ALTER TABLE `recipe_step` ADD `image_id` text REFERENCES image(id);