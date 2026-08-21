CREATE TABLE `action_log` (
	`id` text PRIMARY KEY NOT NULL,
	`ts_start` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`run_id` text,
	`transport` text NOT NULL,
	`protocol_era` text,
	`principal` text NOT NULL,
	`upstream` text NOT NULL,
	`tool` text NOT NULL,
	`upstream_tool` text NOT NULL,
	`args_shape` text,
	`args_redacted` text,
	`args_hash` text NOT NULL,
	`is_error` integer DEFAULT false NOT NULL,
	`error_code` text,
	`error_message` text,
	`result_chars` integer DEFAULT 0 NOT NULL,
	`result_kinds` text DEFAULT '' NOT NULL,
	`result_digest` text,
	`traceparent` text,
	`client_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `action_log_run_ts_idx` ON `action_log` (`run_id`,`ts_start`);--> statement-breakpoint
CREATE INDEX `action_log_tool_ts_idx` ON `action_log` (`tool`,`ts_start`);--> statement-breakpoint
CREATE INDEX `action_log_ts_idx` ON `action_log` (`ts_start`);--> statement-breakpoint
CREATE TABLE `api_key` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text,
	`created_by` text,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_prefix_uq` ON `api_key` (`prefix`);--> statement-breakpoint
CREATE INDEX `api_key_project_active_idx` ON `api_key` (`project_id`) WHERE "api_key"."revoked_at" IS NULL;--> statement-breakpoint
CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`run_id` text,
	`attempt_id` text,
	`kind` text NOT NULL,
	`bucket` text NOT NULL,
	`key` text NOT NULL,
	`sha256` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attempt_id`) REFERENCES `run_attempt`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_bucket_key_uq` ON `artifact` (`bucket`,`key`);--> statement-breakpoint
CREATE INDEX `artifact_sha256_idx` ON `artifact` (`sha256`);--> statement-breakpoint
CREATE INDEX `artifact_run_kind_idx` ON `artifact` (`run_id`,`kind`);--> statement-breakpoint
CREATE TABLE `coverage_map` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`test_case_id` text NOT NULL,
	`platform` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`checksum` text,
	`source` text NOT NULL,
	`captured_run_id` text,
	`captured_at` integer NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_case`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`captured_run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coverage_map_target_uq` ON `coverage_map` (`test_case_id`,`platform`,`kind`,`target`);--> statement-breakpoint
CREATE INDEX `coverage_map_project_kind_target_idx` ON `coverage_map` (`project_id`,`kind`,`target`);--> statement-breakpoint
CREATE TABLE `flaky_stat` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`test_case_id` text NOT NULL,
	`branch` text NOT NULL,
	`platform` text NOT NULL,
	`window_size` integer DEFAULT 20 NOT NULL,
	`executions` integer DEFAULT 0 NOT NULL,
	`transitions` integer DEFAULT 0 NOT NULL,
	`transition_score` real DEFAULT 0 NOT NULL,
	`last_outcomes` text DEFAULT '' NOT NULL,
	`passed_on_retry_shas` text,
	`is_flaky` integer DEFAULT false NOT NULL,
	`is_new` integer DEFAULT false NOT NULL,
	`burn_in_remaining` integer DEFAULT 0 NOT NULL,
	`alarmed_at` integer,
	`recovered_at` integer,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_case`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flaky_stat_case_branch_platform_uq` ON `flaky_stat` (`test_case_id`,`branch`,`platform`);--> statement-breakpoint
CREATE TABLE `handle` (
	`handle` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner` text NOT NULL,
	`project_id` text,
	`platform` text,
	`upstream_ref` text,
	`state` text,
	`ttl_s` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `handle_expires_at_idx` ON `handle` (`expires_at`) WHERE "handle"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `handle_owner_idx` ON `handle` (`owner`);--> statement-breakpoint
CREATE TABLE `heal_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`test_case_id` text,
	`step_id` text,
	`revision_id` text,
	`kind` text NOT NULL,
	`tier` text NOT NULL,
	`old_fingerprint_id` text,
	`new_fingerprint_id` text,
	`score` real,
	`margin` real,
	`candidates` text,
	`evidence` text,
	`yaml_patch` text,
	`run_id` text,
	`attempt_id` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`consecutive_passes` integer DEFAULT 0 NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`feedback_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_case`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`step_id`) REFERENCES `test_step`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `test_case_revision`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`old_fingerprint_id`) REFERENCES `step_fingerprint`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`new_fingerprint_id`) REFERENCES `step_fingerprint`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attempt_id`) REFERENCES `run_attempt`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `heal_proposal_project_status_idx` ON `heal_proposal` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `heal_proposal_status_idx` ON `heal_proposal` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `heal_proposal_step_new_fp_uq` ON `heal_proposal` (`step_id`,`new_fingerprint_id`) WHERE "heal_proposal"."new_fingerprint_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`repo_url` text,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`settings` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_slug_uq` ON `project` (`slug`);--> statement-breakpoint
CREATE TABLE `quarantine` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`test_case_id` text NOT NULL,
	`state` text NOT NULL,
	`previous_state` text,
	`reason` text NOT NULL,
	`owner` text,
	`issue_url` text,
	`exit_criteria` text,
	`consecutive_passes` integer DEFAULT 0 NOT NULL,
	`fix_sha` text,
	`grace_until` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_case`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quarantine_owner_issue_required" CHECK("quarantine"."state" NOT IN ('quarantined', 'disabled') OR ("quarantine"."owner" IS NOT NULL AND "quarantine"."issue_url" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `quarantine_case_created_idx` ON `quarantine` (`test_case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `run` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`meta` text,
	`summary` text,
	`principal` text NOT NULL,
	`git_sha` text,
	`branch` text,
	`base_sha` text,
	`platforms` text,
	`selection` text,
	`idempotency_key` text,
	`infra_outage` integer DEFAULT false NOT NULL,
	`requested_by_api_key_id` text,
	`task_id` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_api_key_id`) REFERENCES `api_key`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_idempotency_key_uq` ON `run` (`idempotency_key`) WHERE "run"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `run_project_branch_created_idx` ON `run` (`project_id`,`branch`,`created_at`);--> statement-breakpoint
CREATE INDEX `run_git_sha_idx` ON `run` (`git_sha`);--> statement-breakpoint
CREATE TABLE `run_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`test_case_id` text NOT NULL,
	`revision_id` text,
	`platform` text NOT NULL,
	`attempt_no` integer DEFAULT 0 NOT NULL,
	`branch` text,
	`git_sha` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`outcome` text,
	`failure_category` text,
	`error_signature` text,
	`handle_id` text,
	`heals_used` integer DEFAULT 0 NOT NULL,
	`transient_steps_used` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_case`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `test_case_revision`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`handle_id`) REFERENCES `handle`(`handle`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_attempt_unique_attempt_uq` ON `run_attempt` (`run_id`,`test_case_id`,`platform`,`attempt_no`);--> statement-breakpoint
CREATE INDEX `run_attempt_case_branch_platform_idx` ON `run_attempt` (`test_case_id`,`branch`,`platform`,`started_at`);--> statement-breakpoint
CREATE INDEX `run_attempt_run_signature_idx` ON `run_attempt` (`run_id`,`error_signature`);--> statement-breakpoint
CREATE TABLE `step_fingerprint` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`step_key` text NOT NULL,
	`platform` text NOT NULL,
	`cache_key` text NOT NULL,
	`signals` text NOT NULL,
	`locator` text,
	`locator_strategy` text,
	`region_hash` text,
	`crop_artifact_id` text,
	`captured_at_run_id` text,
	`verified_passes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_hit_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`captured_at_run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `step_fingerprint_active_cache_key_uq` ON `step_fingerprint` (`project_id`,`cache_key`) WHERE "step_fingerprint"."status" = 'active';--> statement-breakpoint
CREATE INDEX `step_fingerprint_cache_key_idx` ON `step_fingerprint` (`cache_key`);--> statement-breakpoint
CREATE INDEX `step_fingerprint_step_platform_idx` ON `step_fingerprint` (`step_key`,`platform`);--> statement-breakpoint
CREATE INDEX `step_fingerprint_status_idx` ON `step_fingerprint` (`status`);--> statement-breakpoint
CREATE TABLE `step_result` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`step_id` text,
	`ordinal` integer NOT NULL,
	`status` text NOT NULL,
	`cache_status` text,
	`fingerprint_id` text,
	`heal_proposal_id` text,
	`oracle` text,
	`failure_category` text,
	`error_signature` text,
	`error_message` text,
	`snapshot_artifact_id` text,
	`screenshot_artifact_id` text,
	`llm_model` text,
	`llm_tokens_in` integer,
	`llm_tokens_out` integer,
	`duration_ms` integer,
	`started_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `run_attempt`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`step_id`) REFERENCES `test_step`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fingerprint_id`) REFERENCES `step_fingerprint`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`heal_proposal_id`) REFERENCES `heal_proposal`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`screenshot_artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `step_result_attempt_ordinal_uq` ON `step_result` (`attempt_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `step_result_fingerprint_idx` ON `step_result` (`fingerprint_id`);--> statement-breakpoint
CREATE INDEX `step_result_step_status_idx` ON `step_result` (`step_id`,`status`);--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'working' NOT NULL,
	`progress` text,
	`result` text,
	`error` text,
	`input_request` text,
	`ttl_ms` integer,
	`poll_interval_ms` integer,
	`created_by_api_key_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_api_key_id`) REFERENCES `api_key`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_status_expires_idx` ON `task` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `test_case` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`path` text NOT NULL,
	`current_revision_id` text,
	`owners` text,
	`tags` text,
	`platforms` text,
	`status` text DEFAULT 'active' NOT NULL,
	`first_seen_run_id` text,
	`last_run_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_revision_id`) REFERENCES `test_case_revision`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`first_seen_run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_case_project_key_uq` ON `test_case` (`project_id`,`key`);--> statement-breakpoint
CREATE INDEX `test_case_project_status_idx` ON `test_case` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `test_case_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`test_case_id` text NOT NULL,
	`parent_revision_id` text,
	`content_hash` text NOT NULL,
	`content` text NOT NULL,
	`source_text` text,
	`module_hashes` text,
	`git_sha` text,
	`author` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_case`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_revision_id`) REFERENCES `test_case_revision`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_case_revision_hash_uq` ON `test_case_revision` (`test_case_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `test_case_revision_case_created_idx` ON `test_case_revision` (`test_case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `test_step` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`step_key` text NOT NULL,
	`kind` text NOT NULL,
	`intent` text,
	`params` text,
	`flags` text,
	`module_ref` text,
	`platform_overlays` text,
	FOREIGN KEY (`revision_id`) REFERENCES `test_case_revision`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_step_revision_ordinal_uq` ON `test_step` (`revision_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `test_step_key_idx` ON `test_step` (`step_key`);