CREATE TABLE `recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`visibility` text NOT NULL,
	`title` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`source_url` text,
	`source_title` text,
	`source_author` text,
	`equipment` text DEFAULT '[]' NOT NULL,
	`yield_qty` real,
	`yield_unit` text,
	`servings` integer NOT NULL,
	`prep_min` integer,
	`cook_min` integer,
	`total_min` integer,
	`difficulty` text,
	`nutrition_calories` real,
	`nutrition_protein_g` real,
	`nutrition_carbs_g` real,
	`nutrition_fat_g` real,
	`nutrition_fiber_g` real,
	`nutrition_sugar_g` real,
	`nutrition_sodium_mg` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recipe_visibility_check" CHECK("recipe"."visibility" in ('private', 'shared')),
	CONSTRAINT "recipe_difficulty_check" CHECK("recipe"."difficulty" is null or "recipe"."difficulty" in ('easy', 'medium', 'hard')),
	CONSTRAINT "recipe_servings_check" CHECK("recipe"."servings" >= 1),
	CONSTRAINT "recipe_yield_check" CHECK(("recipe"."yield_qty" is null and "recipe"."yield_unit" is null) or ("recipe"."yield_qty" is not null and "recipe"."yield_qty" > 0)),
	CONSTRAINT "recipe_minutes_check" CHECK(coalesce("recipe"."prep_min", 0) >= 0 and coalesce("recipe"."cook_min", 0) >= 0 and coalesce("recipe"."total_min", 0) >= 0),
	CONSTRAINT "recipe_nutrition_check" CHECK(coalesce(`nutrition_calories`, 0) >= 0 and coalesce(`nutrition_protein_g`, 0) >= 0 and coalesce(`nutrition_carbs_g`, 0) >= 0 and coalesce(`nutrition_fat_g`, 0) >= 0 and coalesce(`nutrition_fiber_g`, 0) >= 0 and coalesce(`nutrition_sugar_g`, 0) >= 0 and coalesce(`nutrition_sodium_mg`, 0) >= 0)
);
--> statement-breakpoint
CREATE INDEX `recipe_owner_id_idx` ON `recipe` (`owner_id`);--> statement-breakpoint
CREATE TABLE `recipe_ingredient` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` text NOT NULL,
	`group_position` integer NOT NULL,
	`group_label` text,
	`position` integer NOT NULL,
	`raw_text` text NOT NULL,
	`qty` real,
	`qty_max` real,
	`unit` text,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`note` text,
	`scalable` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recipe_ingredient_qty_check" CHECK("recipe_ingredient"."qty" is null or "recipe_ingredient"."qty" > 0),
	CONSTRAINT "recipe_ingredient_qty_max_check" CHECK("recipe_ingredient"."qty_max" is null or ("recipe_ingredient"."qty" is not null and "recipe_ingredient"."qty_max" > "recipe_ingredient"."qty"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_ingredient_position_idx` ON `recipe_ingredient` (`recipe_id`,`group_position`,`position`);--> statement-breakpoint
CREATE TABLE `recipe_step` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer NOT NULL,
	`body_md` text NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_step_position_idx` ON `recipe_step` (`recipe_id`,`position`);--> statement-breakpoint
CREATE TABLE `recipe_tag` (
	`recipe_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `tag_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_tag_tag_id_idx` ON `recipe_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "tag_type_check" CHECK("tag"."type" in ('cuisine', 'meal_type', 'diet', 'allergen', 'custom'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_type_name_key_idx` ON `tag` (`type`,`name_key`);