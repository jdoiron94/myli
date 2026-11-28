ALTER TABLE `image` ADD `avatar_of` text REFERENCES user(id);--> statement-breakpoint
CREATE UNIQUE INDEX `image_avatar_of_idx` ON `image` (`avatar_of`);