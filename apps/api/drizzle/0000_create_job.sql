CREATE TABLE `job` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "job_status_check" CHECK("job"."status" in ('pending', 'running', 'succeeded', 'dead'))
);
--> statement-breakpoint
CREATE INDEX `job_status_run_after_idx` ON `job` (`status`,`run_after`);