CREATE TABLE `sheet_generation_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`analysis_id` text,
	`rules_analysis_run_id` text,
	`ingestion_id` text,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`is_current` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sheet_generation_runs_current_idx` ON `sheet_generation_runs` (`session_id`,`is_current`);--> statement-breakpoint
CREATE INDEX `sheet_generation_runs_cleanup_idx` ON `sheet_generation_runs` (`status`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sheet_generation_runs_single_current_idx` ON `sheet_generation_runs` (`session_id`) WHERE "sheet_generation_runs"."is_current" = 1;--> statement-breakpoint
CREATE TABLE `sheet_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sheet_sessions_cleanup_idx` ON `sheet_sessions` (`status`,`expires_at`);