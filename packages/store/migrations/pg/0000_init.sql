CREATE TABLE "action_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ts_start" bigint NOT NULL,
	"duration_ms" integer NOT NULL,
	"run_id" text,
	"transport" text NOT NULL,
	"protocol_era" text,
	"principal" text NOT NULL,
	"upstream" text NOT NULL,
	"tool" text NOT NULL,
	"upstream_tool" text NOT NULL,
	"args_shape" jsonb,
	"args_redacted" jsonb,
	"args_hash" text NOT NULL,
	"is_error" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"error_message" text,
	"result_chars" integer DEFAULT 0 NOT NULL,
	"result_kinds" text DEFAULT '' NOT NULL,
	"result_digest" text,
	"traceparent" text,
	"client_name" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb,
	"created_by" text,
	"last_used_at" bigint,
	"expires_at" bigint,
	"revoked_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"run_id" uuid,
	"attempt_id" uuid,
	"kind" text NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" bigint NOT NULL,
	"expires_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coverage_map" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"checksum" text,
	"source" text NOT NULL,
	"captured_run_id" uuid,
	"captured_at" bigint NOT NULL,
	"expires_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flaky_stat" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"branch" text NOT NULL,
	"platform" text NOT NULL,
	"window_size" integer DEFAULT 20 NOT NULL,
	"executions" integer DEFAULT 0 NOT NULL,
	"transitions" integer DEFAULT 0 NOT NULL,
	"transition_score" real DEFAULT 0 NOT NULL,
	"last_outcomes" text DEFAULT '' NOT NULL,
	"passed_on_retry_shas" jsonb,
	"is_flaky" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"burn_in_remaining" integer DEFAULT 0 NOT NULL,
	"alarmed_at" bigint,
	"recovered_at" bigint,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handle" (
	"handle" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"owner" text NOT NULL,
	"project_id" uuid,
	"platform" text,
	"upstream_ref" text,
	"state" jsonb,
	"ttl_s" integer,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked_at" bigint
);
--> statement-breakpoint
CREATE TABLE "heal_proposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"test_case_id" uuid,
	"step_id" uuid,
	"revision_id" uuid,
	"kind" text NOT NULL,
	"tier" text NOT NULL,
	"old_fingerprint_id" uuid,
	"new_fingerprint_id" uuid,
	"score" real,
	"margin" real,
	"candidates" jsonb,
	"evidence" jsonb,
	"yaml_patch" text,
	"run_id" uuid,
	"attempt_id" uuid,
	"status" text DEFAULT 'proposed' NOT NULL,
	"consecutive_passes" integer DEFAULT 0 NOT NULL,
	"decided_by" text,
	"decided_at" bigint,
	"feedback_reason" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"repo_url" text,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"settings" jsonb,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarantine" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"state" text NOT NULL,
	"previous_state" text,
	"reason" text NOT NULL,
	"owner" text,
	"issue_url" text,
	"exit_criteria" jsonb,
	"consecutive_passes" integer DEFAULT 0 NOT NULL,
	"fix_sha" text,
	"grace_until" bigint,
	"created_by" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "quarantine_owner_issue_required" CHECK ("quarantine"."state" NOT IN ('quarantined', 'disabled') OR ("quarantine"."owner" IS NOT NULL AND "quarantine"."issue_url" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"name" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"meta" jsonb,
	"summary" jsonb,
	"principal" text NOT NULL,
	"git_sha" text,
	"branch" text,
	"base_sha" text,
	"platforms" jsonb,
	"selection" jsonb,
	"idempotency_key" text,
	"infra_outage" boolean DEFAULT false NOT NULL,
	"requested_by_api_key_id" uuid,
	"task_id" uuid,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"finished_at" bigint
);
--> statement-breakpoint
CREATE TABLE "run_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"revision_id" uuid,
	"platform" text NOT NULL,
	"attempt_no" integer DEFAULT 0 NOT NULL,
	"branch" text,
	"git_sha" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"failure_category" text,
	"error_signature" text,
	"handle_id" text,
	"heals_used" integer DEFAULT 0 NOT NULL,
	"transient_steps_used" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"started_at" bigint,
	"finished_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_fingerprint" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"platform" text NOT NULL,
	"cache_key" text NOT NULL,
	"signals" jsonb NOT NULL,
	"locator" text,
	"locator_strategy" text,
	"region_hash" text,
	"crop_artifact_id" uuid,
	"captured_at_run_id" uuid,
	"verified_passes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_hit_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_result" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"step_id" uuid,
	"ordinal" integer NOT NULL,
	"status" text NOT NULL,
	"cache_status" text,
	"fingerprint_id" uuid,
	"heal_proposal_id" uuid,
	"oracle" text,
	"failure_category" text,
	"error_signature" text,
	"error_message" text,
	"snapshot_artifact_id" uuid,
	"screenshot_artifact_id" uuid,
	"llm_model" text,
	"llm_tokens_in" integer,
	"llm_tokens_out" integer,
	"duration_ms" integer,
	"started_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'working' NOT NULL,
	"progress" jsonb,
	"result" jsonb,
	"error" jsonb,
	"input_request" jsonb,
	"ttl_ms" integer,
	"poll_interval_ms" integer,
	"created_by_api_key_id" uuid,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"expires_at" bigint
);
--> statement-breakpoint
CREATE TABLE "test_case" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"path" text NOT NULL,
	"current_revision_id" uuid,
	"owners" jsonb,
	"tags" jsonb,
	"platforms" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"first_seen_run_id" uuid,
	"last_run_at" bigint,
	"deleted_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_case_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"test_case_id" uuid NOT NULL,
	"parent_revision_id" uuid,
	"content_hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"source_text" text,
	"module_hashes" jsonb,
	"git_sha" text,
	"author" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_step" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"step_key" text NOT NULL,
	"kind" text NOT NULL,
	"intent" text,
	"params" jsonb,
	"flags" jsonb,
	"module_ref" text,
	"platform_overlays" jsonb
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_attempt_id_run_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."run_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_map" ADD CONSTRAINT "coverage_map_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_map" ADD CONSTRAINT "coverage_map_test_case_id_test_case_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_map" ADD CONSTRAINT "coverage_map_captured_run_id_run_id_fk" FOREIGN KEY ("captured_run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flaky_stat" ADD CONSTRAINT "flaky_stat_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flaky_stat" ADD CONSTRAINT "flaky_stat_test_case_id_test_case_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handle" ADD CONSTRAINT "handle_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heal_proposal" ADD CONSTRAINT "heal_proposal_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heal_proposal" ADD CONSTRAINT "heal_proposal_test_case_id_test_case_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heal_proposal" ADD CONSTRAINT "heal_proposal_step_id_test_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."test_step"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heal_proposal" ADD CONSTRAINT "heal_proposal_revision_id_test_case_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."test_case_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heal_proposal" ADD CONSTRAINT "heal_proposal_old_fingerprint_id_step_fingerprint_id_fk" FOREIGN KEY ("old_fingerprint_id") REFERENCES "public"."step_fingerprint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heal_proposal" ADD CONSTRAINT "heal_proposal_new_fingerprint_id_step_fingerprint_id_fk" FOREIGN KEY ("new_fingerprint_id") REFERENCES "public"."step_fingerprint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heal_proposal" ADD CONSTRAINT "heal_proposal_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heal_proposal" ADD CONSTRAINT "heal_proposal_attempt_id_run_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."run_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine" ADD CONSTRAINT "quarantine_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine" ADD CONSTRAINT "quarantine_test_case_id_test_case_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_requested_by_api_key_id_api_key_id_fk" FOREIGN KEY ("requested_by_api_key_id") REFERENCES "public"."api_key"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempt" ADD CONSTRAINT "run_attempt_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempt" ADD CONSTRAINT "run_attempt_test_case_id_test_case_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempt" ADD CONSTRAINT "run_attempt_revision_id_test_case_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."test_case_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempt" ADD CONSTRAINT "run_attempt_handle_id_handle_handle_fk" FOREIGN KEY ("handle_id") REFERENCES "public"."handle"("handle") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_fingerprint" ADD CONSTRAINT "step_fingerprint_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_fingerprint" ADD CONSTRAINT "step_fingerprint_crop_artifact_id_artifact_id_fk" FOREIGN KEY ("crop_artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_fingerprint" ADD CONSTRAINT "step_fingerprint_captured_at_run_id_run_id_fk" FOREIGN KEY ("captured_at_run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_result" ADD CONSTRAINT "step_result_attempt_id_run_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."run_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_result" ADD CONSTRAINT "step_result_step_id_test_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."test_step"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_result" ADD CONSTRAINT "step_result_fingerprint_id_step_fingerprint_id_fk" FOREIGN KEY ("fingerprint_id") REFERENCES "public"."step_fingerprint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_result" ADD CONSTRAINT "step_result_heal_proposal_id_heal_proposal_id_fk" FOREIGN KEY ("heal_proposal_id") REFERENCES "public"."heal_proposal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_result" ADD CONSTRAINT "step_result_snapshot_artifact_id_artifact_id_fk" FOREIGN KEY ("snapshot_artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_result" ADD CONSTRAINT "step_result_screenshot_artifact_id_artifact_id_fk" FOREIGN KEY ("screenshot_artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_api_key_id_api_key_id_fk" FOREIGN KEY ("created_by_api_key_id") REFERENCES "public"."api_key"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_current_revision_id_test_case_revision_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."test_case_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_first_seen_run_id_run_id_fk" FOREIGN KEY ("first_seen_run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_revision" ADD CONSTRAINT "test_case_revision_test_case_id_test_case_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_revision" ADD CONSTRAINT "test_case_revision_parent_revision_id_test_case_revision_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."test_case_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_step" ADD CONSTRAINT "test_step_revision_id_test_case_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."test_case_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_log_run_ts_idx" ON "action_log" USING btree ("run_id","ts_start");--> statement-breakpoint
CREATE INDEX "action_log_tool_ts_idx" ON "action_log" USING btree ("tool","ts_start");--> statement-breakpoint
CREATE INDEX "action_log_ts_idx" ON "action_log" USING btree ("ts_start");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_prefix_uq" ON "api_key" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "api_key_project_active_idx" ON "api_key" USING btree ("project_id") WHERE "api_key"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_bucket_key_uq" ON "artifact" USING btree ("bucket","key");--> statement-breakpoint
CREATE INDEX "artifact_sha256_idx" ON "artifact" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "artifact_run_kind_idx" ON "artifact" USING btree ("run_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "coverage_map_target_uq" ON "coverage_map" USING btree ("test_case_id","platform","kind","target");--> statement-breakpoint
CREATE INDEX "coverage_map_project_kind_target_idx" ON "coverage_map" USING btree ("project_id","kind","target");--> statement-breakpoint
CREATE UNIQUE INDEX "flaky_stat_case_branch_platform_uq" ON "flaky_stat" USING btree ("test_case_id","branch","platform");--> statement-breakpoint
CREATE INDEX "handle_expires_at_idx" ON "handle" USING btree ("expires_at") WHERE "handle"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "handle_owner_idx" ON "handle" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "heal_proposal_project_status_idx" ON "heal_proposal" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "heal_proposal_status_idx" ON "heal_proposal" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "heal_proposal_step_new_fp_uq" ON "heal_proposal" USING btree ("step_id","new_fingerprint_id") WHERE "heal_proposal"."new_fingerprint_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_slug_uq" ON "project" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "quarantine_case_created_idx" ON "quarantine" USING btree ("test_case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_idempotency_key_uq" ON "run" USING btree ("idempotency_key") WHERE "run"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "run_project_branch_created_idx" ON "run" USING btree ("project_id","branch","created_at");--> statement-breakpoint
CREATE INDEX "run_git_sha_idx" ON "run" USING btree ("git_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "run_attempt_unique_attempt_uq" ON "run_attempt" USING btree ("run_id","test_case_id","platform","attempt_no");--> statement-breakpoint
CREATE INDEX "run_attempt_case_branch_platform_idx" ON "run_attempt" USING btree ("test_case_id","branch","platform","started_at");--> statement-breakpoint
CREATE INDEX "run_attempt_run_signature_idx" ON "run_attempt" USING btree ("run_id","error_signature");--> statement-breakpoint
CREATE UNIQUE INDEX "step_fingerprint_active_cache_key_uq" ON "step_fingerprint" USING btree ("project_id","cache_key") WHERE "step_fingerprint"."status" = 'active';--> statement-breakpoint
CREATE INDEX "step_fingerprint_cache_key_idx" ON "step_fingerprint" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "step_fingerprint_step_platform_idx" ON "step_fingerprint" USING btree ("step_key","platform");--> statement-breakpoint
CREATE INDEX "step_fingerprint_status_idx" ON "step_fingerprint" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "step_result_attempt_ordinal_uq" ON "step_result" USING btree ("attempt_id","ordinal");--> statement-breakpoint
CREATE INDEX "step_result_fingerprint_idx" ON "step_result" USING btree ("fingerprint_id");--> statement-breakpoint
CREATE INDEX "step_result_step_status_idx" ON "step_result" USING btree ("step_id","status");--> statement-breakpoint
CREATE INDEX "task_status_expires_idx" ON "task" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "test_case_project_key_uq" ON "test_case" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "test_case_project_status_idx" ON "test_case" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "test_case_revision_hash_uq" ON "test_case_revision" USING btree ("test_case_id","content_hash");--> statement-breakpoint
CREATE INDEX "test_case_revision_case_created_idx" ON "test_case_revision" USING btree ("test_case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "test_step_revision_ordinal_uq" ON "test_step" USING btree ("revision_id","ordinal");--> statement-breakpoint
CREATE INDEX "test_step_key_idx" ON "test_step" USING btree ("step_key");