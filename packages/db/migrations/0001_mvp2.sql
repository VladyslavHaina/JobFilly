CREATE TABLE "assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"turn" integer NOT NULL,
	"text" text NOT NULL,
	"clarify" jsonb,
	"proposal_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_messages_role_check" CHECK (role in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "assistant_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"request" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"impact" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_proposals_status_check" CHECK (status in ('open', 'applied', 'discarded'))
);
--> statement-breakpoint
CREATE TABLE "assistant_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_threads_workspace_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "cvs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"content_hash" text NOT NULL,
	"text" text,
	"metadata" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"read_status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cvs_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "cvs_size_check" CHECK (octet_length(content) <= 5242880),
	CONSTRAINT "cvs_media_type_check" CHECK (media_type in ('pdf', 'docx')),
	CONSTRAINT "cvs_read_status_check" CHECK (read_status in ('pending', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "decision_messages" (
	"decision_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"position" integer NOT NULL,
	"state" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decision_messages_decision_id_message_id_position_pk" PRIMARY KEY("decision_id","message_id","position"),
	CONSTRAINT "decision_messages_state_check" CHECK (state in ('waiting', 'dismissed', 'resolved')),
	CONSTRAINT "decision_messages_source_check" CHECK (source in ('draft', 'match', 'rule'))
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"profile_key" text,
	"question" text NOT NULL,
	"choices" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"answer" jsonb,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decisions_status_check" CHECK (status in ('open', 'answered'))
);
--> statement-breakpoint
CREATE TABLE "domain_lookups" (
	"workspace_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"result" jsonb,
	"looked_up_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "domain_lookups_workspace_id_domain_kind_pk" PRIMARY KEY("workspace_id","domain","kind"),
	CONSTRAINT "domain_lookups_kind_check" CHECK (kind in ('rdap', 'mx'))
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"position" integer NOT NULL,
	"status" text NOT NULL,
	"failure_kind" text,
	"failure_reason" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"claimed_at" timestamp with time zone,
	"origin" text NOT NULL,
	"subject" text,
	"body" text,
	"language" text,
	"cv_id" uuid,
	"mailbox_folder" text,
	"uid" bigint,
	"uid_validity" bigint,
	"draft_message_id" text,
	"content_hash" text,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "drafts_status_check" CHECK (status in ('saving', 'in_mailbox', 'edited', 'discarded', 'failed')),
	CONSTRAINT "drafts_failure_kind_check" CHECK (failure_kind is null or failure_kind in ('mailbox', 'ai', 'content')),
	CONSTRAINT "drafts_origin_check" CHECK (origin in ('auto', 'on_demand', 'decision', 'retry'))
);
--> statement-breakpoint
CREATE TABLE "mailbox_sync" (
	"workspace_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"folder_path" text NOT NULL,
	"uid_validity" bigint,
	"last_uid" bigint,
	"last_synced_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"last_error" text,
	"last_error_reason" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_sync_mailbox_id_folder_path_pk" PRIMARY KEY("mailbox_id","folder_path"),
	CONSTRAINT "mailbox_sync_last_error_reason_check" CHECK (last_error_reason is null or last_error_reason in ('wrong_password', 'unreachable', 'tls', 'insecure_refused', 'secret_error', 'error'))
);
--> statement-breakpoint
CREATE TABLE "match_ai_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"position" integer NOT NULL,
	"cv_id" uuid,
	"input_hash" text NOT NULL,
	"answer" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_ai_answers_key" UNIQUE NULLS NOT DISTINCT("workspace_id","message_id","position","cv_id","input_hash")
);
--> statement-breakpoint
CREATE TABLE "profile_cvs" (
	"workspace_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"cv_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_cvs_profile_id_cv_id_pk" PRIMARY KEY("profile_id","cv_id")
);
--> statement-breakpoint
CREATE TABLE "profile_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by" uuid,
	"source" text NOT NULL,
	"request" text,
	"changes" jsonb NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	CONSTRAINT "profile_history_source_check" CHECK (source in ('scan', 'you', 'decision', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "role_cv_choices" (
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"position" integer NOT NULL,
	"cv_id" uuid NOT NULL,
	"chosen_by" uuid,
	"chosen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "role_cv_choices_workspace_id_message_id_position_pk" PRIMARY KEY("workspace_id","message_id","position")
);
--> statement-breakpoint
CREATE TABLE "role_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"position" integer NOT NULL,
	"score" integer,
	"capped" boolean DEFAULT false NOT NULL,
	"match" jsonb,
	"hidden_rule_id" uuid,
	"hidden_reason" text,
	"rule_effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cv_id" uuid,
	"cv_reason" text NOT NULL,
	"cv_source" text DEFAULT 'auto' NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"stale_since" timestamp with time zone,
	"evaluated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "role_evaluations_role_key" UNIQUE("workspace_id","message_id","position"),
	CONSTRAINT "role_evaluations_cv_source_check" CHECK (cv_source in ('auto', 'you'))
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"description" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"action" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rules_action_check" CHECK (action in ('hide', 'no_draft', 'ask_first', 'cap_score')),
	CONSTRAINT "rules_source_check" CHECK (source in ('you', 'decision', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "sender_checks" (
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"verdict" text NOT NULL,
	"complete" boolean NOT NULL,
	"reasons" jsonb NOT NULL,
	"mark" text,
	"stale" boolean DEFAULT false NOT NULL,
	"stale_since" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sender_checks_workspace_id_message_id_pk" PRIMARY KEY("workspace_id","message_id"),
	CONSTRAINT "sender_checks_verdict_check" CHECK (verdict in ('looks_fine', 'caution', 'high_risk')),
	CONSTRAINT "sender_checks_mark_check" CHECK (mark is null or mark in ('trusted', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "sender_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"value" text NOT NULL,
	"mark" text NOT NULL,
	"marked_by" uuid,
	"marked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sender_marks_key" UNIQUE("workspace_id","scope","value"),
	CONSTRAINT "sender_marks_scope_check" CHECK (scope in ('address', 'domain')),
	CONSTRAINT "sender_marks_mark_check" CHECK (mark in ('trusted', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "stage_failures" (
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"stage" text NOT NULL,
	"position" integer NOT NULL,
	"failures" integer NOT NULL,
	"failed_at" timestamp with time zone NOT NULL,
	"retry_at" timestamp with time zone NOT NULL,
	"stale_since" timestamp with time zone,
	CONSTRAINT "stage_failures_workspace_id_message_id_stage_position_pk" PRIMARY KEY("workspace_id","message_id","stage","position"),
	CONSTRAINT "stage_failures_stage_check" CHECK (stage in ('sender', 'match'))
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sync_analysis_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Hand-placed: the composite foreign keys below reference profiles (workspace_id, id).
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_workspace_id_key" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_thread_fk" FOREIGN KEY ("workspace_id","thread_id") REFERENCES "public"."assistant_threads"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_thread_fk" FOREIGN KEY ("workspace_id","thread_id") REFERENCES "public"."assistant_threads"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."profiles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cvs" ADD CONSTRAINT "cvs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cvs" ADD CONSTRAINT "cvs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_messages" ADD CONSTRAINT "decision_messages_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_messages" ADD CONSTRAINT "decision_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_messages" ADD CONSTRAINT "decision_messages_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."messages"("workspace_id","message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_lookups" ADD CONSTRAINT "domain_lookups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."messages"("workspace_id","message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_cv_fk" FOREIGN KEY ("workspace_id","cv_id") REFERENCES "public"."cvs"("workspace_id","id") ON DELETE SET NULL ("cv_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_sync" ADD CONSTRAINT "mailbox_sync_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_sync" ADD CONSTRAINT "mailbox_sync_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_ai_answers" ADD CONSTRAINT "match_ai_answers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_ai_answers" ADD CONSTRAINT "match_ai_answers_role_fk" FOREIGN KEY ("workspace_id","message_id","position") REFERENCES "public"."roles"("workspace_id","message_id","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_ai_answers" ADD CONSTRAINT "match_ai_answers_cv_fk" FOREIGN KEY ("workspace_id","cv_id") REFERENCES "public"."cvs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_cvs" ADD CONSTRAINT "profile_cvs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_cvs" ADD CONSTRAINT "profile_cvs_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."profiles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_cvs" ADD CONSTRAINT "profile_cvs_cv_fk" FOREIGN KEY ("workspace_id","cv_id") REFERENCES "public"."cvs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_history" ADD CONSTRAINT "profile_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_history" ADD CONSTRAINT "profile_history_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_history" ADD CONSTRAINT "profile_history_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_history" ADD CONSTRAINT "profile_history_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."profiles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_cv_choices" ADD CONSTRAINT "role_cv_choices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_cv_choices" ADD CONSTRAINT "role_cv_choices_chosen_by_users_id_fk" FOREIGN KEY ("chosen_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_cv_choices" ADD CONSTRAINT "role_cv_choices_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."messages"("workspace_id","message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_cv_choices" ADD CONSTRAINT "role_cv_choices_cv_fk" FOREIGN KEY ("workspace_id","cv_id") REFERENCES "public"."cvs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_evaluations" ADD CONSTRAINT "role_evaluations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_evaluations" ADD CONSTRAINT "role_evaluations_role_fk" FOREIGN KEY ("workspace_id","message_id","position") REFERENCES "public"."roles"("workspace_id","message_id","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_evaluations" ADD CONSTRAINT "role_evaluations_cv_fk" FOREIGN KEY ("workspace_id","cv_id") REFERENCES "public"."cvs"("workspace_id","id") ON DELETE SET NULL ("cv_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."profiles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_checks" ADD CONSTRAINT "sender_checks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_checks" ADD CONSTRAINT "sender_checks_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."messages"("workspace_id","message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_marks" ADD CONSTRAINT "sender_marks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_marks" ADD CONSTRAINT "sender_marks_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_failures" ADD CONSTRAINT "stage_failures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_failures" ADD CONSTRAINT "stage_failures_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."messages"("workspace_id","message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_messages_thread_idx" ON "assistant_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_proposals_thread_idx" ON "assistant_proposals" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "assistant_threads_workspace_user_idx" ON "assistant_threads" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "cvs_workspace_idx" ON "cvs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "decision_messages_role_idx" ON "decision_messages" USING btree ("workspace_id","message_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_one_open_idx" ON "decisions" USING btree ("workspace_id","group_key") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_one_live_idx" ON "drafts" USING btree ("workspace_id","message_id","position") WHERE status <> 'discarded';--> statement-breakpoint
CREATE INDEX "drafts_workspace_status_idx" ON "drafts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "drafts_cv_idx" ON "drafts" USING btree ("cv_id");--> statement-breakpoint
CREATE INDEX "match_ai_answers_cv_idx" ON "match_ai_answers" USING btree ("cv_id");--> statement-breakpoint
CREATE INDEX "profile_cvs_cv_idx" ON "profile_cvs" USING btree ("cv_id");--> statement-breakpoint
CREATE INDEX "profile_history_profile_at_idx" ON "profile_history" USING btree ("workspace_id","profile_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "role_cv_choices_cv_idx" ON "role_cv_choices" USING btree ("cv_id");--> statement-breakpoint
CREATE INDEX "role_evaluations_cv_idx" ON "role_evaluations" USING btree ("cv_id");--> statement-breakpoint
CREATE INDEX "rules_workspace_profile_idx" ON "rules" USING btree ("workspace_id","profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_queued_idx" ON "jobs" USING btree ("dedupe_key") WHERE status = 'queued' and dedupe_key is not null;--> statement-breakpoint
CREATE INDEX "jobs_dedupe_running_idx" ON "jobs" USING btree ("dedupe_key") WHERE status = 'running' and dedupe_key is not null;--> statement-breakpoint
-- Hand-written: drafts_cv_fk and role_evaluations_cv_fk clear only cv_id (ON DELETE SET NULL
-- ("cv_id")), so deleting a CV keeps the row and its workspace_id.
-- Hand-written: the new tasks' models (cv, match, draft, assistant) start as the workspace's
-- extract model (TBD-168), so MVP 1 workspaces keep working without opening Settings; a model
-- already set is kept.
UPDATE "ai_settings" SET "models" = jsonb_build_object('cv', "models"->'extract', 'match', "models"->'extract', 'draft', "models"->'extract', 'assistant', "models"->'extract') || "models";
