-- pg_trgm backs the sender and subject search (F5.5); it is a trusted extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"base_url" text,
	"models" jsonb NOT NULL,
	"key_ciphertext" text,
	"budget_per_run" integer DEFAULT 300 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scan_id" uuid,
	"task" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_answers_workspace_key_key" UNIQUE("workspace_id","key"),
	CONSTRAINT "intake_answers_source_check" CHECK (source in ('scan', 'you'))
);
--> statement-breakpoint
CREATE TABLE "intake_extras" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_extras_status_check" CHECK (status in ('pending', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_role_check" CHECK (role in ('viewer', 'editor', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"previous_owner" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK (status in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"address" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"tls_mode" text NOT NULL,
	"username" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"sent_folder_path" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "mailboxes_tls_mode_check" CHECK (tls_mode in ('tls', 'starttls', 'none')),
	CONSTRAINT "mailboxes_status_check" CHECK (status in ('connected', 'failing'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK (role in ('viewer', 'editor', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"folder" text NOT NULL,
	"folder_path" text NOT NULL,
	"uid_validity" bigint NOT NULL,
	"uid" bigint NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_addresses" jsonb NOT NULL,
	"cc_addresses" jsonb NOT NULL,
	"reply_to" jsonb NOT NULL,
	"in_reply_to" text,
	"references" jsonb NOT NULL,
	"list_id" text,
	"list_unsubscribe" text,
	"precedence" text,
	"auto_submitted" text,
	"date" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"snippet" varchar(200) NOT NULL,
	"stage_one" text NOT NULL,
	"stage_one_reason" text,
	"category" text,
	"category_source" text,
	"analysis_status" text DEFAULT 'pending' NOT NULL,
	"analyzed_by_scan_id" uuid,
	"preferences" jsonb,
	"search_text" text GENERATED ALWAYS AS (lower(coalesce(from_name, '') || ' ' || from_address || ' ' || subject)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_workspace_message_id_key" UNIQUE("workspace_id","message_id"),
	CONSTRAINT "messages_folder_check" CHECK (folder in ('inbox', 'sent')),
	CONSTRAINT "messages_stage_one_check" CHECK (stage_one in ('not_job', 'likely_job', 'own_reply', 'job_alert')),
	CONSTRAINT "messages_category_check" CHECK (category is null or category in ('recruiter_outreach', 'job_alert', 'application_update', 'interview', 'assessment', 'offer', 'rejection', 'other_job', 'not_job')),
	CONSTRAINT "messages_category_source_check" CHECK (category_source is null or category_source in ('scan', 'you')),
	CONSTRAINT "messages_analysis_status_check" CHECK (analysis_status in ('pending', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entries" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"position" integer NOT NULL,
	"facts" jsonb NOT NULL,
	CONSTRAINT "roles_workspace_message_position_key" UNIQUE("workspace_id","message_id","position")
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stop_reason" text,
	"counts" jsonb NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"started_by" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	CONSTRAINT "scans_kind_check" CHECK (kind in ('first', 'analyze_rest')),
	CONSTRAINT "scans_status_check" CHECK (status in ('queued', 'running', 'stopped'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_answers" ADD CONSTRAINT "intake_answers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_answers" ADD CONSTRAINT "intake_answers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_extras" ADD CONSTRAINT "intake_extras_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_analyzed_by_scan_id_scans_id_fk" FOREIGN KEY ("analyzed_by_scan_id") REFERENCES "public"."scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."messages"("workspace_id","message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_workspace_scan_idx" ON "ai_usage" USING btree ("workspace_id","scan_id");--> statement-breakpoint
CREATE INDEX "invites_workspace_idx" ON "invites" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "invites_email_idx" ON "invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "jobs_status_lease_idx" ON "jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_workspace_category_date_idx" ON "messages" USING btree ("workspace_id","category","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_workspace_date_idx" ON "messages" USING btree ("workspace_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_search_text_trgm_idx" ON "messages" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "profiles_workspace_idx" ON "profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "scans_workspace_started_idx" ON "scans" USING btree ("workspace_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "scans_one_active_idx" ON "scans" USING btree ("workspace_id") WHERE status in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");