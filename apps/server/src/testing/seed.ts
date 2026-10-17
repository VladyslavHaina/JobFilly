import { createHash } from "node:crypto";
import {
  addMember,
  createMailbox,
  createScan,
  createWorkspace,
  getScan,
  insertCv,
  linkProfileCv,
  listMembers,
  registerAccount,
  saveAiSettings,
  stopScan,
  updateCv,
  updateScanProgress,
} from "@jobfilly/db";
import {
  type AiModels,
  type AiProviderId,
  type Cv,
  type CvMediaType,
  type CvTag,
  DEFAULT_BUDGET_PER_RUN,
  EMPTY_SCAN_COUNTS,
  type MailConnection,
  type Role,
  type Scan,
  type ScanCounts,
  type ScanKind,
  type ScanStatus,
  type StopReason,
} from "@jobfilly/schema";
import { hashPassword } from "../auth/password";
import type { AppDeps } from "../deps";
import { personalWorkspaceName } from "../routes/auth";
import { seal } from "../secrets";

// Seeding for server tests, always through the workspace-scoped @jobfilly/db functions (never
// raw SQL), with secrets sealed exactly as the app seals them.

export interface SeededUser {
  id: string;
  name: string;
  email: string;
  password: string;
  /** The personal workspace created at registration. */
  workspaceId: string;
}

/** Cheap scrypt parameters, so tests don't spend seconds hashing; verify reads them back. */
const TEST_SCRYPT = { N: 2 ** 10, r: 8, p: 1 };

let counter = 0;

/** Registers a user with their personal workspace ("<full name>'s workspace"). */
export async function seedUser(
  deps: AppDeps,
  input: { name?: string; email?: string; password?: string } = {},
): Promise<SeededUser> {
  counter += 1;
  const name = input.name ?? `Test User ${counter}`;
  const email = (input.email ?? `user${counter}.${Date.now()}@test.example`).toLowerCase();
  const password = input.password ?? `correct horse battery ${counter}`;
  const result = await registerAccount(deps.db, {
    name,
    email,
    passwordHash: await hashPassword(password, TEST_SCRYPT),
    workspaceName: personalWorkspaceName(name),
  });
  if (!result.ok) throw new Error(`seedUser: ${email} is taken`);
  return { id: result.user.id, name, email, password, workspaceId: result.workspaceId };
}

export interface SeededWorkspace {
  workspaceId: string;
  owner: SeededUser;
  members: { user: SeededUser; role: Role }[];
}

/** A workspace with an owner (an admin) and members with the given roles. */
export async function seedWorkspace(
  deps: AppDeps,
  input: { name?: string; owner?: SeededUser; members?: { user: SeededUser; role: Role }[] } = {},
): Promise<SeededWorkspace> {
  const owner = input.owner ?? (await seedUser(deps));
  const { id } = await createWorkspace(deps.db, {
    name: input.name ?? "Test workspace",
    ownerId: owner.id,
  });
  for (const m of input.members ?? []) await addMember(deps.db, id, m.user.id, m.role);
  return { workspaceId: id, owner, members: input.members ?? [] };
}

/** Connects a mailbox, its password sealed with the app's key. Returns the mailbox id. */
export async function seedMailbox(
  deps: AppDeps,
  workspaceId: string,
  input: { address: string; conn: MailConnection; sentFolderPath: string | null },
): Promise<string> {
  const result = await createMailbox(deps.db, workspaceId, {
    address: input.address,
    host: input.conn.host,
    port: input.conn.port,
    tlsMode: input.conn.tlsMode,
    username: input.conn.username,
    secretCiphertext: seal(deps.config.secretKey, input.conn.password),
    sentFolderPath: input.sentFolderPath,
  });
  if (!result.ok)
    throw new Error("seedMailbox: the workspace already has a mailbox at that address");
  // PGlite keeps created_at to the millisecond; without a tick between two seeds the "oldest
  // mailbox first" order would fall back to the random id and make tests flaky.
  await new Promise((resolve) => setTimeout(resolve, 2));
  return result.mailboxId;
}

/** Saves AI settings, the key sealed with the app's key (null: no key). */
export async function seedAiSettings(
  deps: AppDeps,
  workspaceId: string,
  input: {
    provider: AiProviderId;
    baseUrl: string | null;
    models: AiModels;
    apiKey: string | null;
    budgetPerRun?: number;
  },
): Promise<void> {
  await saveAiSettings(deps.db, workspaceId, {
    provider: input.provider,
    baseUrl: input.baseUrl,
    models: input.models,
    keyCiphertext: input.apiKey === null ? null : seal(deps.config.secretKey, input.apiKey),
    budgetPerRun: input.budgetPerRun ?? DEFAULT_BUDGET_PER_RUN,
  });
}

/** A scan in the given state, started by `startedBy` (default: the workspace's first admin). */
export async function seedScan(
  deps: AppDeps,
  workspaceId: string,
  input: {
    kind: ScanKind;
    status: ScanStatus;
    stopReason?: StopReason;
    startedBy?: string;
    counts?: Partial<ScanCounts>;
    calls?: number;
  },
): Promise<Scan> {
  const startedBy =
    input.startedBy ??
    (await listMembers(deps.db, workspaceId)).find((m) => m.role === "admin")?.userId;
  if (!startedBy) throw new Error("seedScan: the workspace has no admin");
  const created = await createScan(deps.db, workspaceId, {
    kind: input.kind,
    startedBy,
    at: deps.clock.now(),
  });
  if (!created.ok) throw new Error("seedScan: a scan is already queued or running");
  const progress = {
    counts: { ...EMPTY_SCAN_COUNTS, ...input.counts },
    calls: input.calls ?? 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  if (input.status !== "queued" || input.counts || input.calls) {
    await updateScanProgress(deps.db, workspaceId, created.scan.id, {
      status: input.status === "queued" ? "queued" : "running",
      ...progress,
    });
  }
  if (input.status === "stopped") {
    await stopScan(
      deps.db,
      workspaceId,
      created.scan.id,
      input.stopReason ?? "done",
      deps.clock.now(),
    );
  }
  const scan = await getScan(deps.db, workspaceId, created.scan.id);
  if (!scan) throw new Error("seedScan: the scan vanished");
  return scan;
}

/**
 * A CV as if uploaded and read (tests of the replies and rules-match slices make CVs without the
 * cvs-senders slice): its bytes, its text, and what cv.v1 read, linked to `profileId` when given.
 */
export async function seedCv(
  deps: AppDeps,
  workspaceId: string,
  input: {
    name: string;
    mediaType?: CvMediaType;
    fileName?: string;
    bytes?: Uint8Array;
    text?: string;
    language?: string | null;
    skills?: string[];
    roleFamilies?: string[];
    seniority?: string | null;
    tags?: CvTag[];
    preferred?: boolean;
    /** Leave it unread (readStatus pending, no metadata). */
    unread?: boolean;
    profileId?: string;
    createdBy?: string | null;
  },
): Promise<Cv> {
  const mediaType = input.mediaType ?? "pdf";
  const bytes = input.bytes ?? new TextEncoder().encode(`%PDF-1.4 ${input.name}`);
  const cv = await insertCv(deps.db, workspaceId, {
    name: input.name,
    fileName: input.fileName ?? `${input.name}.${mediaType}`,
    mediaType,
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    text: input.unread ? null : (input.text ?? input.skills?.join(", ") ?? ""),
    metadata: input.unread
      ? null
      : {
          language: input.language ?? "en",
          skills: input.skills ?? [],
          roleFamilies: input.roleFamilies ?? [],
          seniority: input.seniority ?? null,
          countryHints: [],
          formatHints: [],
        },
    tags: input.tags ?? [],
    createdBy: input.createdBy ?? null,
    at: deps.clock.now(),
  });
  if (input.profileId) await linkProfileCv(deps.db, workspaceId, input.profileId, cv.id);
  if (!input.preferred) return cv;
  return (await updateCv(deps.db, workspaceId, cv.id, { preferred: true }, deps.clock.now())) ?? cv;
}
