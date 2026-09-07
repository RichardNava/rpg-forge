CREATE TABLE `rules_analysis_sessions` (
	`analysis_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rules_analysis_sessions_cleanup_idx` ON `rules_analysis_sessions` (`status`,`expires_at`);