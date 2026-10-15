import type {
  Address,
  AiModels,
  AiProviderId,
  AnalysisStatus,
  Category,
  CategorySource,
  ExtraQuestion,
  IntakeExtrasStatus,
  JobFacts,
  MailboxStatus,
  MailFolder,
  Preferences,
  ProfileEntry,
  ProfileSource,
  ProfileValue,
  Role,
  ScanCounts,
  ScanKind,
  ScanStatus,
  StageOneVerdict,
  StopReason,
  TaskId,
  TlsMode,
} from "@jobfilly/schema";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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

// Every MVP 1 table. Every workspace-owned row carries workspace_id, and the queries in
// ./queries only ever read or write it with a workspace id. Slices add no tables: a column a
// slice needs is added here, in a new migration, by the foundation.

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

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    kind: text("kind").$type<ScanKind>().notNull(),
    status: text("status").$type<ScanStatus>().notNull().default("queued"),
    stopReason: text("stop_reason").$type<StopReason>(),
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
  (t) => [index("profiles_workspace_idx").on(t.workspaceId)],
);

export type JobStatus = "queued" | "running" | "done" | "failed";

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
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    index("jobs_status_lease_idx").on(t.status, t.leaseExpiresAt),
    check("jobs_status_check", oneOf("status", ["queued", "running", "done", "failed"])),
  ],
);
