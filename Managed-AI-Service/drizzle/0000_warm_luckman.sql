CREATE TABLE `daily_usage` (
	`day` text NOT NULL,
	`scope` text NOT NULL,
	`subject` text NOT NULL,
	`used` integer NOT NULL,
	PRIMARY KEY(`day`, `scope`, `subject`)
);
--> statement-breakpoint
CREATE TABLE `installations` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_hash` text NOT NULL,
	`created_day` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_claims` (
	`installation_id` text NOT NULL,
	`request_id` text NOT NULL,
	`digest` text NOT NULL,
	`task` text NOT NULL,
	`status` text NOT NULL,
	`created_day` text NOT NULL,
	PRIMARY KEY(`installation_id`, `request_id`),
	FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON UPDATE no action ON DELETE no action
);
