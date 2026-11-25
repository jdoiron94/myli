ALTER TABLE `recipe` ADD `public_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_public_token_idx` ON `recipe` (`public_token`);