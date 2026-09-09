CREATE TABLE `rules_analysis_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`ingestion_id` text NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`is_current` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rules_analysis_runs_current_idx` ON `rules_analysis_runs` (`analysis_id`,`is_current`);--> statement-breakpoint
CREATE INDEX `rules_analysis_runs_generation_idx` ON `rules_analysis_runs` (`analysis_id`,`ingestion_id`);--> statement-breakpoint
CREATE INDEX `rules_analysis_runs_cleanup_idx` ON `rules_analysis_runs` (`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `rules_analysis_runs_single_current_idx` ON `rules_analysis_runs` (`analysis_id`) WHERE "rules_analysis_runs"."is_current" = 1;