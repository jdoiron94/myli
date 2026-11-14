CREATE TABLE `setup_claim` (
	`id` integer PRIMARY KEY NOT NULL,
	`claimed_at` integer NOT NULL,
	CONSTRAINT "setup_claim_single_row" CHECK("setup_claim"."id" = 1)
);
