CREATE TABLE `rules_analysis_rulebooks` (
	`analysis_id` text PRIMARY KEY NOT NULL,
	`ingestion_id` text NOT NULL,
	`status` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`page_count` integer,
	`chunk_count` integer,
	`extracted_chars` integer,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rules_analysis_rulebooks_ingestion_id_idx` ON `rules_analysis_rulebooks` (`ingestion_id`);--> statement-breakpoint
CREATE INDEX `rules_analysis_rulebooks_cleanup_idx` ON `rules_analysis_rulebooks` (`status`,`updated_at`);