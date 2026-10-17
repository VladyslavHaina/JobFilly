CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"target_user_id" uuid,
	"refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "activity_log_kind_check" CHECK (kind in ('draft.saved', 'mail.sent', 'member.invited', 'member.role_changed', 'member.scope_changed', 'member.removed', 'member.left', 'workspace.ownership_transferred', 'export.downloaded', 'mailbox.disconnected', 'account.deleted')),
	CONSTRAINT "activity_log_actor_kind_check" CHECK (actor_kind in ('user', 'system'))
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"state_hash" text NOT NULL,
	"verifier_ciphertext" text NOT NULL,
	"mailbox_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oauth_states_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "oauth_states_provider_check" CHECK (provider in ('google'))
);
--> statement-breakpoint
CREATE TABLE "role_profile_choices" (
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"position" integer NOT NULL,
	"profile_id" uuid NOT NULL,
	"chosen_by" uuid,
	"chosen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "role_profile_choices_workspace_id_message_id_position_pk" PRIMARY KEY("workspace_id","message_id","position")
);
--> statement-breakpoint
CREATE TABLE "role_stages" (
	"workspace_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"position" integer NOT NULL,
	"stage" text NOT NULL,
	"set_by" uuid,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "role_stages_workspace_id_message_id_position_pk" PRIMARY KEY("workspace_id","message_id","position"),
	CONSTRAINT "role_stages_stage_check" CHECK (stage in ('new', 'replied', 'applied', 'interview', 'assessment', 'offer', 'rejected', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"position" integer NOT NULL,
	"mailbox_id" uuid,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"outgoing_message_id" text,
	"sent_at" timestamp with time zone,
	"failure_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sends_status_check" CHECK (status in ('scheduled', 'cancelled', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "mailboxes" DROP CONSTRAINT "mailboxes_workspace_id_unique";--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_workspace_id_key" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_workspace_id_key" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_workspace_address_key" UNIQUE("workspace_id","address");--> statement-breakpoint
ALTER TABLE "drafts" DROP CONSTRAINT "drafts_status_check";--> statement-breakpoint
ALTER TABLE "mailboxes" DROP CONSTRAINT "mailboxes_status_check";--> statement-breakpoint
ALTER TABLE "scans" DROP CONSTRAINT "scans_kind_check";--> statement-breakpoint
ALTER TABLE "scans" DROP CONSTRAINT "scans_started_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "scans" ALTER COLUMN "started_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "sources" jsonb;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "scope" text DEFAULT 'everything' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "auth_kind" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "smtp_tls_mode" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "smtp_username" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "smtp_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "scope" text DEFAULT 'everything' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mailbox_id" uuid;--> statement-breakpoint
UPDATE "messages" SET "mailbox_id" = "mailboxes"."id" FROM "mailboxes" WHERE "mailboxes"."workspace_id" = "messages"."workspace_id";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "role_evaluations" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "role_evaluations" ADD COLUMN "profile_reason" text;--> statement-breakpoint
ALTER TABLE "role_evaluations" ADD COLUMN "profile_source" text;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "hint" text;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "focus" jsonb;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "public"."mailboxes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_profile_choices" ADD CONSTRAINT "role_profile_choices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_profile_choices" ADD CONSTRAINT "role_profile_choices_chosen_by_users_id_fk" FOREIGN KEY ("chosen_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_profile_choices" ADD CONSTRAINT "role_profile_choices_role_fk" FOREIGN KEY ("workspace_id","message_id","position") REFERENCES "public"."roles"("workspace_id","message_id","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_profile_choices" ADD CONSTRAINT "role_profile_choices_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."profiles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_stages" ADD CONSTRAINT "role_stages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_stages" ADD CONSTRAINT "role_stages_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_stages" ADD CONSTRAINT "role_stages_role_fk" FOREIGN KEY ("workspace_id","message_id","position") REFERENCES "public"."roles"("workspace_id","message_id","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_draft_fk" FOREIGN KEY ("workspace_id","draft_id") REFERENCES "public"."drafts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "public"."messages"("workspace_id","message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_workspace_at_idx" ON "activity_log" USING btree ("workspace_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sends_one_pending_idx" ON "sends" USING btree ("draft_id") WHERE status in ('scheduled', 'sending');--> statement-breakpoint
CREATE INDEX "sends_workspace_draft_idx" ON "sends" USING btree ("workspace_id","draft_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "public"."mailboxes"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_evaluations" ADD CONSTRAINT "role_evaluations_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."profiles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_workspace_mailbox_idx" ON "messages" USING btree ("workspace_id","mailbox_id");--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_status_check" CHECK (status in ('saving', 'in_mailbox', 'edited', 'discarded', 'failed', 'sent'));--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_scope_check" CHECK (scope in ('everything', 'pipeline'));--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_auth_kind_check" CHECK (auth_kind in ('password', 'google'));--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_smtp_tls_mode_check" CHECK (smtp_tls_mode is null or smtp_tls_mode in ('tls', 'starttls', 'none'));--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_status_check" CHECK (status in ('connected', 'failing', 'reconnect_needed'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_scope_check" CHECK (scope in ('everything', 'pipeline'));--> statement-breakpoint
ALTER TABLE "role_evaluations" ADD CONSTRAINT "role_evaluations_profile_source_check" CHECK (profile_source is null or profile_source in ('auto', 'you'));--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_kind_check" CHECK (kind in ('first', 'analyze_rest', 'rerun'));
-- Hand-written: the unique keys on drafts and mailboxes moved before the composite foreign keys
-- that reference them (sends_draft_fk, messages_mailbox_fk, oauth_states_mailbox_fk), and
-- messages.mailbox_id is filled from the workspace's one mailbox (one per workspace until now);
-- mail of a mailbox disconnected before stays null.
