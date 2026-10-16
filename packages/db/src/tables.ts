import type {
  Address,
  AiModels,
  AiProviderId,
  AnalysisStatus,
  Category,
  CategorySource,
  Change,
  Condition,
  CvMediaType,
  CvReadOutput,
  CvReadStatus,
  CvTag,
  DecisionChoice,
  DecisionNeed,
  DraftFailureKind,
  DraftOrigin,
  DraftStatus,
  ExtraQuestion,
  Impact,
  IntakeExtrasStatus,
  JobFacts,
  JobStatus,
  MailboxStatus,
  MailFolder,
  Match,
  MatchAiOutput,
  MxLookupResult,
  Preferences,
  ProfileEntry,
  ProfileItem,
  ProfileSnapshot,
  ProfileSource,
  ProfileValue,
  RdapLookupResult,
  Role,
  RuleAction,
  RuleEffect,
  RuleSource,
  ScanCounts,
  ScanKind,
  ScanStatus,
  SenderMark,
  SenderMarkScope,
  SenderReason,
  SenderVerdict,
  StageOneVerdict,
  StopCause,
  StopReason,
  SyncFailureReason,
  TaskId,
  TlsMode,
} from "@jobfilly/schema";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Every table. Every workspace-owned row carries workspace_id, and the queries in ./queries only
// ever read or write it with a workspace id. Slices add no tables: a column a slice needs is
// added here, in a new migration, by the foundation. MVP 1's tables come first, then MVP 2's
// (migration 0001_mvp2).
//
// A reference from one workspace-owned row to another includes workspace_id: a composite foreign
// key to the target's (workspace_id, id) or (workspace_id, message_id), so the database itself
// refuses a row that points into another workspace. A set-null one clears only the id column
// (ON DELETE SET NULL (cv_id), hand-written in the migration), which keeps workspace_id.

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => at("created_at").notNull().defaultNow();
const updatedAt = () => at("updated_at").notNull().defaultNow();

/** A text column limited to the given values by a check constraint (cheaper to extend than an enum). */
function oneOf(column: string, values: readonly string[]) {
  return sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);
}

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Stored lower case; unique across the server. */
  email: text("email").notNull().unique(),
  /** scrypt hash with its parameters and salt; never the password. */
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 of the cookie value; the value itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: at("created_at").notNull(),
    lastUsedAt: at("last_used_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

const workspaceId = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

const ROLES = ["viewer", "editor", "admin"] as const satisfies readonly Role[];

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: workspaceId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
    check("memberships_role_check", oneOf("role", ROLES)),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    /** Stored lower case. */
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    /** SHA-256 of the token in the copyable link. */
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: at("created_at").notNull(),
    expiresAt: at("expires_at").notNull(),
    revokedAt: at("revoked_at"),
    acceptedAt: at("accepted_at"),
    declinedAt: at("declined_at"),
  },
  (t) => [
    index("invites_workspace_idx").on(t.workspaceId),
    index("invites_email_idx").on(t.email),
    check("invites_role_check", oneOf("role", ROLES)),
  ],
);

export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Unique: one mailbox per workspace in MVP 1 (F2.5). */
    workspaceId: workspaceId().unique(),
    address: text("address").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    tlsMode: text("tls_mode").$type<TlsMode>().notNull(),
    username: text("username").notNull(),
    /** The password sealed with AES-256-GCM (apps/server secrets.ts). */
    secretCiphertext: text("secret_ciphertext").notNull(),
    sentFolderPath: text("sent_folder_path"),
    status: text("status").$type<MailboxStatus>().notNull().default("connected"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check("mailboxes_tls_mode_check", oneOf("tls_mode", ["tls", "starttls", "none"])),
    check("mailboxes_status_check", oneOf("status", ["connected", "failing"])),
  ],
);

export const aiSettings = pgTable("ai_settings", {
  workspaceId: workspaceId().primaryKey(),
  provider: text("provider").$type<AiProviderId>().notNull(),
  baseUrl: text("base_url"),
  models: jsonb("models").$type<AiModels>().notNull(),
  /** The API key sealed with AES-256-GCM, or null when the provider needs none. */
  keyCiphertext: text("key_ciphertext"),
  budgetPerRun: integer("budget_per_run").notNull().default(300),
  updatedAt: updatedAt(),
});

const SCAN_STATUSES = ["queued", "running", "stopped"] as const satisfies readonly ScanStatus[];
const STOP_CAUSES = ["mailbox", "ai", "internal"] as const satisfies readonly StopCause[];

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    kind: text("kind").$type<ScanKind>().notNull(),
    status: text("status").$type<ScanStatus>().notNull().default("queued"),
    stopReason: text("stop_reason").$type<StopReason>(),
    /** What a failed run ran into (mailbox, ai or internal); null for every other stop. */
    stopCause: text("stop_cause").$type<StopCause>(),
    counts: jsonb("counts").$type<ScanCounts>().notNull(),
    calls: integer("calls").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    startedBy: uuid("started_by")
      .notNull()
      .references(() => users.id),
    startedAt: at("started_at").notNull(),
    stoppedAt: at("stopped_at"),
  },
  (t) => [
    index("scans_workspace_started_idx").on(t.workspaceId, t.startedAt.desc()),
    // At most one queued or running scan per workspace.
    uniqueIndex("scans_one_active_idx")
      .on(t.workspaceId)
      .where(sql`status in ('queued', 'running')`),
    check("scans_kind_check", oneOf("kind", ["first", "analyze_rest"])),
    check("scans_status_check", oneOf("status", SCAN_STATUSES)),
    check("scans_stop_cause_check", sql`stop_cause is null or ${oneOf("stop_cause", STOP_CAUSES)}`),
  ],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    /** The scan run the call belonged to; null for calls outside a run (Test, intake.v1). */
    scanId: uuid("scan_id").references(() => scans.id, { onDelete: "set null" }),
    task: text("task").$type<TaskId>().notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    at: at("at").notNull().defaultNow(),
  },
  (t) => [index("ai_usage_workspace_scan_idx").on(t.workspaceId, t.scanId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    /** The RFC Message-ID, verbatim with angle brackets: the message's id outside this table. */
    messageId: text("message_id").notNull(),
    folder: text("folder").$type<MailFolder>().notNull(),
    folderPath: text("folder_path").notNull(),
    uidValidity: bigint("uid_validity", { mode: "number" }).notNull(),
    uid: bigint("uid", { mode: "number" }).notNull(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toAddresses: jsonb("to_addresses").$type<Address[]>().notNull(),
    ccAddresses: jsonb("cc_addresses").$type<Address[]>().notNull(),
    replyTo: jsonb("reply_to").$type<Address[]>().notNull(),
    inReplyTo: text("in_reply_to"),
    references: jsonb("references").$type<string[]>().notNull(),
    listId: text("list_id"),
    listUnsubscribe: text("list_unsubscribe"),
    precedence: text("precedence"),
    autoSubmitted: text("auto_submitted"),
    date: at("date").notNull(),
    subject: text("subject").notNull(),
    /** At most 200 characters from the start of the plain text; bodies are never stored. */
    snippet: varchar("snippet", { length: 200 }).notNull(),
    stageOne: text("stage_one").$type<StageOneVerdict>().notNull(),
    stageOneReason: text("stage_one_reason"),
    category: text("category").$type<Category>(),
    categorySource: text("category_source").$type<CategorySource>(),
    analysisStatus: text("analysis_status").$type<AnalysisStatus>().notNull().default("pending"),
    analyzedByScanId: uuid("analyzed_by_scan_id").references(() => scans.id, {
      onDelete: "set null",
    }),
    /** What one of the user's own replies states (prefs.v1). */
    preferences: jsonb("preferences").$type<Preferences>(),
    /**
     * The body's language (ISO 639-1) as the sender stage detected it; null until a sender check
     * read the body. The pipeline stores it, so CV choice and re-scoring never need the mailbox.
     */
    language: text("language"),
    /**
     * How many syncs tried to have the model sort this message and couldn't (the provider
     * failing, or no AI set up): after a few the sync no longer holds its cursor for it.
     */
    syncAnalysisFailures: integer("sync_analysis_failures").notNull().default(0),
    searchText: text("search_text").generatedAlwaysAs(
      sql`lower(coalesce(from_name, '') || ' ' || from_address || ' ' || subject)`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("messages_workspace_message_id_key").on(t.workspaceId, t.messageId),
    index("messages_workspace_category_date_idx").on(t.workspaceId, t.category, t.date.desc()),
    index("messages_workspace_date_idx").on(t.workspaceId, t.date.desc()),
    index("messages_search_text_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
    check("messages_folder_check", oneOf("folder", ["inbox", "sent"])),
    check(
      "messages_stage_one_check",
      oneOf("stage_one", ["not_job", "likely_job", "own_reply", "job_alert"]),
    ),
    check(
      "messages_category_check",
      sql`category is null or ${oneOf("category", [
        "recruiter_outreach",
        "job_alert",
        "application_update",
        "interview",
        "assessment",
        "offer",
        "rejection",
        "other_job",
        "not_job",
      ])}`,
    ),
    check(
      "messages_category_source_check",
      sql`category_source is null or ${oneOf("category_source", ["scan", "you"])}`,
    ),
    check(
      "messages_analysis_status_check",
      oneOf("analysis_status", ["pending", "done", "failed"]),
    ),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    messageId: text("message_id").notNull(),
    /** 0-based order of the role within its message (a job alert lists several). */
    position: integer("position").notNull(),
    facts: jsonb("facts").$type<JobFacts>().notNull(),
  },
  (t) => [
    foreignKey({
      name: "roles_message_fk",
      columns: [t.workspaceId, t.messageId],
      foreignColumns: [messages.workspaceId, messages.messageId],
    }).onDelete("cascade"),
    unique("roles_workspace_message_position_key").on(t.workspaceId, t.messageId, t.position),
  ],
);

export const intakeAnswers = pgTable(
  "intake_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    /** A core key or extra.<slug>. */
    key: text("key").notNull(),
    value: jsonb("value").$type<ProfileValue>().notNull(),
    source: text("source").$type<ProfileSource>().notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("intake_answers_workspace_key_key").on(t.workspaceId, t.key),
    check("intake_answers_source_check", oneOf("source", ["scan", "you"])),
  ],
);

export const intakeExtras = pgTable(
  "intake_extras",
  {
    workspaceId: workspaceId().primaryKey(),
    status: text("status").$type<Exclude<IntakeExtrasStatus, "none">>().notNull(),
    questions: jsonb("questions").$type<ExtraQuestion[]>().notNull().default([]),
    /** The replica that claimed the one intake.v1 call. */
    claimedBy: text("claimed_by"),
    claimedAt: at("claimed_at"),
    updatedAt: updatedAt(),
  },
  () => [check("intake_extras_status_check", oneOf("status", ["pending", "done", "failed"]))],
);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    entries: jsonb("entries").$type<ProfileEntry[]>().notNull(),
    confirmedAt: at("confirmed_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("profiles_workspace_idx").on(t.workspaceId),
    unique("profiles_workspace_id_key").on(t.workspaceId, t.id),
  ],
);

/** The job queue: scans today, mail sync and drafting later. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    workspaceId: workspaceId(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    /** The instance (replica hostname) holding the lease while running. */
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: at("lease_expires_at"),
    /** The instance that held the job before this one took it over or got it handed back. */
    previousOwner: text("previous_owner"),
    attempts: integer("attempts").notNull().default(0),
    checkpoint: jsonb("checkpoint").$type<unknown>(),
    /**
     * Jobs with the same key are one piece of work (TBD-178): at most one waits (the unique
     * index while queued), and the claim skips a queued one while another with the key runs
     * under a live lease (claimJob).
     */
    dedupeKey: text("dedupe_key"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    index("jobs_status_lease_idx").on(t.status, t.leaseExpiresAt),
    uniqueIndex("jobs_dedupe_queued_idx")
      .on(t.dedupeKey)
      .where(sql`status = 'queued' and dedupe_key is not null`),
    index("jobs_dedupe_running_idx")
      .on(t.dedupeKey)
      .where(sql`status = 'running' and dedupe_key is not null`),
    check("jobs_status_check", oneOf("status", ["queued", "running", "done", "failed"])),
  ],
);

// --- MVP 2 ---------------------------------------------------------------------------------------
//
// CV foreign keys (TBD-197) are simple keys on cvs.id, so deleting a CV (cvs-senders) never hits
// a key held elsewhere: links (profile_cvs), overrides (role_cv_choices) and stored match answers
// go with it (CASCADE); drafts and role evaluations stay and forget it (SET NULL), so a draft
// already in the mailbox stays there (F2.5) and the next evaluation chooses a CV again.

/** bytea as a Uint8Array (node-postgres gives a Buffer, PGlite a Uint8Array). */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array | string }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) =>
    typeof value === "string"
      ? new Uint8Array(Buffer.from(value.replace(/^\\x/, ""), "hex"))
      : new Uint8Array(value),
});

/** The largest CV file (MAX_CV_BYTES in @jobfilly/schema): 5 MB. */
const MAX_CV_BYTES_SQL = 5 * 1024 * 1024;

export const cvs = pgTable(
  "cvs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    fileName: text("file_name").notNull(),
    mediaType: text("media_type").$type<CvMediaType>().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** The file itself (F2.4): in Postgres, never on a replica's disk. */
    content: bytea("content").notNull(),
    /** SHA-256 of the content, lower-case hex: cv.v1's key. */
    contentHash: text("content_hash").notNull(),
    /** The text read from the file; null until read. */
    text: text("text"),
    /** What cv.v1 read, skills already checked against the text (F2.2); null until read. */
    metadata: jsonb("metadata").$type<CvReadOutput>(),
    tags: jsonb("tags").$type<CvTag[]>().notNull().default([]),
    readStatus: text("read_status").$type<CvReadStatus>().notNull().default("pending"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("cvs_workspace_idx").on(t.workspaceId),
    unique("cvs_workspace_id_key").on(t.workspaceId, t.id),
    check("cvs_size_check", sql`octet_length(content) <= ${sql.raw(String(MAX_CV_BYTES_SQL))}`),
    check("cvs_media_type_check", oneOf("media_type", ["pdf", "docx"])),
    check("cvs_read_status_check", oneOf("read_status", ["pending", "done", "failed"])),
  ],
);

/** Which CVs a profile uses (F2). */
export const profileCvs = pgTable(
  "profile_cvs",
  {
    workspaceId: workspaceId(),
    profileId: uuid("profile_id").notNull(),
    cvId: uuid("cv_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.cvId] }),
    foreignKey({
      name: "profile_cvs_profile_fk",
      columns: [t.workspaceId, t.profileId],
      foreignColumns: [profiles.workspaceId, profiles.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "profile_cvs_cv_fk",
      columns: [t.workspaceId, t.cvId],
      foreignColumns: [cvs.workspaceId, cvs.id],
    }).onDelete("cascade"),
    index("profile_cvs_cv_idx").on(t.cvId),
  ],
);

/** An editor's CV choice for one role (F2.3); no row means the automatic choice. */
export const roleCvChoices = pgTable(
  "role_cv_choices",
  {
    workspaceId: workspaceId(),
    messageId: text("message_id").notNull(),
    position: integer("position").notNull(),
    cvId: uuid("cv_id").notNull(),
    chosenBy: uuid("chosen_by").references(() => users.id, { onDelete: "set null" }),
    chosenAt: at("chosen_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.messageId, t.position] }),
    foreignKey({
      name: "role_cv_choices_message_fk",
      columns: [t.workspaceId, t.messageId],
      foreignColumns: [messages.workspaceId, messages.messageId],
    }).onDelete("cascade"),
    foreignKey({
      name: "role_cv_choices_cv_fk",
      columns: [t.workspaceId, t.cvId],
      foreignColumns: [cvs.workspaceId, cvs.id],
    }).onDelete("cascade"),
    index("role_cv_choices_cv_idx").on(t.cvId),
  ],
);

const RULE_ACTIONS_SQL = ["hide", "no_draft", "ask_first", "cap_score"] as const;
const RULE_SOURCES_SQL = ["you", "decision", "assistant"] as const;

/** Rules in the profile (F3). */
export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    profileId: uuid("profile_id").notNull(),
    description: text("description").notNull(),
    conditions: jsonb("conditions").$type<Condition[]>().notNull(),
    action: text("action").$type<RuleAction>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    source: text("source").$type<RuleSource>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    index("rules_workspace_profile_idx").on(t.workspaceId, t.profileId),
    foreignKey({
      name: "rules_profile_fk",
      columns: [t.workspaceId, t.profileId],
      foreignColumns: [profiles.workspaceId, profiles.id],
    }).onDelete("cascade"),
    check("rules_action_check", oneOf("action", RULE_ACTIONS_SQL)),
    check("rules_source_check", oneOf("source", RULE_SOURCES_SQL)),
  ],
);

/**
 * One role's evaluation (RoleEvaluation): its match, the rule hiding it, every rule's effect and
 * the CV chosen. `stale` marks it out of date after a change, until it is evaluated again.
 */
export const roleEvaluations = pgTable(
  "role_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    messageId: text("message_id").notNull(),
    position: integer("position").notNull(),
    score: integer("score"),
    capped: boolean("capped").notNull().default(false),
    match: jsonb("match").$type<Match>(),
    hiddenRuleId: uuid("hidden_rule_id"),
    hiddenReason: text("hidden_reason"),
    ruleEffects: jsonb("rule_effects").$type<RuleEffect[]>().notNull().default([]),
    cvId: uuid("cv_id"),
    cvReason: text("cv_reason").notNull(),
    cvSource: text("cv_source").$type<"auto" | "you">().notNull().default("auto"),
    stale: boolean("stale").notNull().default(false),
    /** When it was last marked stale; null while current. */
    staleSince: at("stale_since"),
    evaluatedAt: at("evaluated_at").notNull(),
  },
  (t) => [
    unique("role_evaluations_role_key").on(t.workspaceId, t.messageId, t.position),
    foreignKey({
      name: "role_evaluations_role_fk",
      columns: [t.workspaceId, t.messageId, t.position],
      foreignColumns: [roles.workspaceId, roles.messageId, roles.position],
    }).onDelete("cascade"),
    // ON DELETE SET NULL (cv_id) in the migration: deleting the CV keeps the evaluation.
    foreignKey({
      name: "role_evaluations_cv_fk",
      columns: [t.workspaceId, t.cvId],
      foreignColumns: [cvs.workspaceId, cvs.id],
    }).onDelete("set null"),
    index("role_evaluations_cv_idx").on(t.cvId),
    check("role_evaluations_cv_source_check", oneOf("cv_source", ["auto", "you"])),
  ],
);

/**
 * Stored match.v1 answers (TBD-175): keyed by the role, the CV and the hash of exactly what the
 * model saw, so a rule or pay change re-scores without a model call.
 */
export const matchAiAnswers = pgTable(
  "match_ai_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    messageId: text("message_id").notNull(),
    position: integer("position").notNull(),
    cvId: uuid("cv_id"),
    inputHash: text("input_hash").notNull(),
    answer: jsonb("answer").$type<MatchAiOutput>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("match_ai_answers_key")
      .on(t.workspaceId, t.messageId, t.position, t.cvId, t.inputHash)
      .nullsNotDistinct(),
    foreignKey({
      name: "match_ai_answers_role_fk",
      columns: [t.workspaceId, t.messageId, t.position],
      foreignColumns: [roles.workspaceId, roles.messageId, roles.position],
    }).onDelete("cascade"),
    foreignKey({
      name: "match_ai_answers_cv_fk",
      columns: [t.workspaceId, t.cvId],
      foreignColumns: [cvs.workspaceId, cvs.id],
    }).onDelete("cascade"),
    index("match_ai_answers_cv_idx").on(t.cvId),
  ],
);

/** A message sender's check (F5); stale after a mark changes, until checked again. */
export const senderChecks = pgTable(
  "sender_checks",
  {
    workspaceId: workspaceId(),
    messageId: text("message_id").notNull(),
    verdict: text("verdict").$type<SenderVerdict>().notNull(),
    complete: boolean("complete").notNull(),
    reasons: jsonb("reasons").$type<SenderReason[]>().notNull(),
    mark: text("mark").$type<SenderMark>(),
    stale: boolean("stale").notNull().default(false),
    staleSince: at("stale_since"),
    checkedAt: at("checked_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.messageId] }),
    foreignKey({
      name: "sender_checks_message_fk",
      columns: [t.workspaceId, t.messageId],
      foreignColumns: [messages.workspaceId, messages.messageId],
    }).onDelete("cascade"),
    check("sender_checks_verdict_check", oneOf("verdict", ["looks_fine", "caution", "high_risk"])),
    check(
      "sender_checks_mark_check",
      sql`mark is null or ${oneOf("mark", ["trusted", "blocked"])}`,
    ),
  ],
);

/**
 * A pipeline stage that keeps failing for one message (queries/stage-failures.ts): its sender
 * check (stage sender, position -1), one role's cv-choice and match (stage match), or its reply
 * stage (stage reply, position -1: it works on every role of the message at once). It is tried
 * again at the next sweep after its first failure, then with a back-off that doubles up to a cap
 * (retry_at), unless a change makes the item stale again. Stored here, so every replica agrees.
 * `stale_since` is the role evaluation's as it was when the stage failed: a later markStale
 * changes it, which makes the role due at once. Deleted when the stage succeeds.
 */
export const stageFailures = pgTable(
  "stage_failures",
  {
    workspaceId: workspaceId(),
    messageId: text("message_id").notNull(),
    stage: text("stage").$type<"sender" | "match" | "reply">().notNull(),
    position: integer("position").notNull(),
    failures: integer("failures").notNull(),
    failedAt: at("failed_at").notNull(),
    retryAt: at("retry_at").notNull(),
    staleSince: at("stale_since"),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.messageId, t.stage, t.position] }),
    foreignKey({
      name: "stage_failures_message_fk",
      columns: [t.workspaceId, t.messageId],
      foreignColumns: [messages.workspaceId, messages.messageId],
    }).onDelete("cascade"),
    check("stage_failures_stage_check", oneOf("stage", ["sender", "match", "reply"])),
  ],
);

/** An editor's trusted or blocked mark on an address or a domain (F5.4). */
export const senderMarks = pgTable(
  "sender_marks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    scope: text("scope").$type<SenderMarkScope>().notNull(),
    /** Lower case. */
    value: text("value").notNull(),
    mark: text("mark").$type<SenderMark>().notNull(),
    markedBy: uuid("marked_by").references(() => users.id, { onDelete: "set null" }),
    markedAt: at("marked_at").notNull(),
  },
  (t) => [
    unique("sender_marks_key").on(t.workspaceId, t.scope, t.value),
    check("sender_marks_scope_check", oneOf("scope", ["address", "domain"])),
    check("sender_marks_mark_check", oneOf("mark", ["trusted", "blocked"])),
  ],
);

/** Cached RDAP and MX lookups, per workspace (TBD-165). */
export const domainLookups = pgTable(
  "domain_lookups",
  {
    workspaceId: workspaceId(),
    domain: text("domain").notNull(),
    kind: text("kind").$type<"rdap" | "mx">().notNull(),
    ok: boolean("ok").notNull(),
    /** RdapLookupResult or MxLookupResult by kind, null for a failure; parsed where it is read. */
    result: jsonb("result").$type<RdapLookupResult | MxLookupResult>(),
    lookedUpAt: at("looked_up_at").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.domain, t.kind] }),
    check("domain_lookups_kind_check", oneOf("kind", ["rdap", "mx"])),
  ],
);

const DRAFT_STATUSES_SQL = ["saving", "in_mailbox", "edited", "discarded", "failed"] as const;

/**
 * Reply drafts (F6). The row holds the reply text only; the quote of the original is added when
 * the MIME message is built. One live draft per role (TBD-179): the partial unique index allows a
 * new row only once the previous one is discarded.
 */
export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    messageId: text("message_id").notNull(),
    position: integer("position").notNull(),
    status: text("status").$type<DraftStatus>().notNull(),
    failureKind: text("failure_kind").$type<DraftFailureKind>(),
    failureReason: text("failure_reason"),
    /** How many times draft.create has tried to write it (retries count). */
    attempts: integer("attempts").notNull().default(1),
    /** When the current saving claim was taken. */
    claimedAt: at("claimed_at"),
    origin: text("origin").$type<DraftOrigin>().notNull(),
    subject: text("subject"),
    /** The reply text only, never the quoted original. */
    body: text("body"),
    language: text("language"),
    cvId: uuid("cv_id"),
    /**
     * The file name of the CV attached to the mailbox copy, null when it has none. It stays when
     * the CV is deleted (cv_id goes null, F2.5): the copy keeps the file, and an edit takes it
     * from there.
     */
    attachmentName: text("attachment_name"),
    /** Where the mailbox copy is. */
    mailboxFolder: text("mailbox_folder"),
    uid: bigint("uid", { mode: "number" }),
    uidValidity: bigint("uid_validity", { mode: "number" }),
    draftMessageId: text("draft_message_id"),
    /** SHA-256 of the subject, body and attachment of the mailbox copy. */
    contentHash: text("content_hash"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("drafts_one_live_idx")
      .on(t.workspaceId, t.messageId, t.position)
      .where(sql`status <> 'discarded'`),
    index("drafts_workspace_status_idx").on(t.workspaceId, t.status),
    foreignKey({
      name: "drafts_message_fk",
      columns: [t.workspaceId, t.messageId],
      foreignColumns: [messages.workspaceId, messages.messageId],
    }).onDelete("cascade"),
    // ON DELETE SET NULL (cv_id) in the migration: the mailbox draft stays when its CV goes (F2.5).
    foreignKey({
      name: "drafts_cv_fk",
      columns: [t.workspaceId, t.cvId],
      foreignColumns: [cvs.workspaceId, cvs.id],
    }).onDelete("set null"),
    index("drafts_cv_idx").on(t.cvId),
    check("drafts_status_check", oneOf("status", DRAFT_STATUSES_SQL)),
    check(
      "drafts_failure_kind_check",
      sql`failure_kind is null or ${oneOf("failure_kind", ["mailbox", "ai", "content"])}`,
    ),
    check("drafts_origin_check", oneOf("origin", ["auto", "on_demand", "decision", "retry"])),
  ],
);

/** The decision inbox (F7): one open decision per group key. */
export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    groupKey: text("group_key").notNull(),
    /** The entry an answer writes; null for an ask_first rule. */
    profileKey: text("profile_key"),
    question: text("question").notNull(),
    choices: jsonb("choices").$type<DecisionChoice[]>().notNull(),
    status: text("status").$type<"open" | "answered">().notNull().default("open"),
    answer: jsonb("answer").$type<ProfileItem>(),
    answeredBy: uuid("answered_by").references(() => users.id, { onDelete: "set null" }),
    answeredAt: at("answered_at"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("decisions_one_open_idx").on(t.workspaceId, t.groupKey).where(sql`status = 'open'`),
    check("decisions_status_check", oneOf("status", ["open", "answered"])),
  ],
);

/** The roles waiting on a decision, and what became of each (F7.2, F7.5). */
export const decisionMessages = pgTable(
  "decision_messages",
  {
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    workspaceId: workspaceId(),
    messageId: text("message_id").notNull(),
    position: integer("position").notNull(),
    state: text("state").$type<"waiting" | "dismissed" | "resolved">().notNull(),
    source: text("source").$type<DecisionNeed["source"]>().notNull(),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.decisionId, t.messageId, t.position] }),
    foreignKey({
      name: "decision_messages_message_fk",
      columns: [t.workspaceId, t.messageId],
      foreignColumns: [messages.workspaceId, messages.messageId],
    }).onDelete("cascade"),
    index("decision_messages_role_idx").on(t.workspaceId, t.messageId, t.position),
    check("decision_messages_state_check", oneOf("state", ["waiting", "dismissed", "resolved"])),
    check(
      "decision_messages_source_check",
      oneOf("source", ["draft", "draft_on_demand", "match", "rule"]),
    ),
  ],
);

/** One member's conversation with the assistant (F8). */
export const assistantThreads = pgTable(
  "assistant_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    index("assistant_threads_workspace_user_idx").on(t.workspaceId, t.userId),
    unique("assistant_threads_workspace_id_key").on(t.workspaceId, t.id),
  ],
);

/** The messages of a thread: stored for the history, never logged (F8.10). */
export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    threadId: uuid("thread_id").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    /** 1 for the first user message of the thread; the assistant's reply shares its turn. */
    turn: integer("turn").notNull(),
    text: text("text").notNull(),
    clarify: jsonb("clarify").$type<{ question: string; choices: string[] }>(),
    proposalId: uuid("proposal_id"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    index("assistant_messages_thread_idx").on(t.threadId, t.createdAt),
    foreignKey({
      name: "assistant_messages_thread_fk",
      columns: [t.workspaceId, t.threadId],
      foreignColumns: [assistantThreads.workspaceId, assistantThreads.id],
    }).onDelete("cascade"),
    check("assistant_messages_role_check", oneOf("role", ["user", "assistant"])),
  ],
);

/** A proposal card (TBD-167): its changes, before and after, impact and status. */
export const assistantProposals = pgTable(
  "assistant_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    threadId: uuid("thread_id").notNull(),
    profileId: uuid("profile_id").notNull(),
    /** The user's words that led to it, kept for the profile history (F8.4). */
    request: text("request").notNull(),
    summary: text("summary").notNull(),
    changes: jsonb("changes").$type<Change[]>().notNull(),
    before: jsonb("before").$type<ProfileSnapshot>().notNull(),
    after: jsonb("after").$type<ProfileSnapshot>().notNull(),
    impact: jsonb("impact").$type<Impact>().notNull(),
    status: text("status").$type<"open" | "applied" | "discarded">().notNull().default("open"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: at("decided_at"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    index("assistant_proposals_thread_idx").on(t.threadId),
    foreignKey({
      name: "assistant_proposals_thread_fk",
      columns: [t.workspaceId, t.threadId],
      foreignColumns: [assistantThreads.workspaceId, assistantThreads.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "assistant_proposals_profile_fk",
      columns: [t.workspaceId, t.profileId],
      foreignColumns: [profiles.workspaceId, profiles.id],
    }).onDelete("cascade"),
    check("assistant_proposals_status_check", oneOf("status", ["open", "applied", "discarded"])),
  ],
);

/** Every applied change to a profile's entries and rules (F8.4), with before and after. */
export const profileHistory = pgTable(
  "profile_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    profileId: uuid("profile_id").notNull(),
    at: at("at").notNull(),
    by: uuid("by").references(() => users.id, { onDelete: "set null" }),
    source: text("source").$type<ProfileSource>().notNull(),
    request: text("request"),
    changes: jsonb("changes").$type<Change[]>().notNull(),
    before: jsonb("before").$type<ProfileSnapshot>().notNull(),
    after: jsonb("after").$type<ProfileSnapshot>().notNull(),
    undoneAt: at("undone_at"),
    undoneBy: uuid("undone_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("profile_history_profile_at_idx").on(t.workspaceId, t.profileId, t.at.desc()),
    foreignKey({
      name: "profile_history_profile_fk",
      columns: [t.workspaceId, t.profileId],
      foreignColumns: [profiles.workspaceId, profiles.id],
    }).onDelete("cascade"),
    check(
      "profile_history_source_check",
      oneOf("source", ["scan", "you", "decision", "assistant"]),
    ),
  ],
);

const SYNC_FAILURE_REASONS = [
  "wrong_password",
  "unreachable",
  "tls",
  "insecure_refused",
  "secret_error",
  "error",
] as const satisfies readonly SyncFailureReason[];

/**
 * The continuous sync's state per mailbox and folder (F1): where it got to (UIDVALIDITY and the
 * last UID), when it last worked, since when it fails and why, and when it may try again
 * (back-off, F1.4).
 */
export const mailboxSync = pgTable(
  "mailbox_sync",
  {
    workspaceId: workspaceId(),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    folderPath: text("folder_path").notNull(),
    uidValidity: bigint("uid_validity", { mode: "number" }),
    lastUid: bigint("last_uid", { mode: "number" }),
    lastSyncedAt: at("last_synced_at"),
    failingSince: at("failing_since"),
    /** Plain words, never the server's own text. */
    lastError: text("last_error"),
    /** Why the last sync failed, for the UI to branch on; null with no failure. */
    lastErrorReason: text("last_error_reason").$type<SyncFailureReason>(),
    failures: integer("failures").notNull().default(0),
    nextAttemptAt: at("next_attempt_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.mailboxId, t.folderPath] }),
    check(
      "mailbox_sync_last_error_reason_check",
      sql`last_error_reason is null or ${oneOf("last_error_reason", SYNC_FAILURE_REASONS)}`,
    ),
  ],
);
