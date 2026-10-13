ALTER TABLE `sheet_draft_heads` ADD COLUMN `undo_source_version` integer;
--> statement-breakpoint
ALTER TABLE `sheet_draft_heads` ADD COLUMN `undo_consumed` integer NOT NULL DEFAULT 0;