CREATE TABLE `sheet_draft_heads` (
	`session_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`current_version` integer NOT NULL,
	`pending_version` integer,
	`pending_claim_id` text,
	`pending_since` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `draft_id`)
);
--> statement-breakpoint
CREATE INDEX `sheet_draft_heads_session_idx` ON `sheet_draft_heads` (`session_id`);--> statement-breakpoint
CREATE INDEX `sheet_draft_heads_pending_idx` ON `sheet_draft_heads` (`pending_version`,`pending_since`);--> statement-breakpoint
ALTER TABLE `sheet_generation_runs` ADD `draft_id` text;--> statement-breakpoint
ALTER TABLE `sheet_generation_runs` ADD `draft_version` integer;