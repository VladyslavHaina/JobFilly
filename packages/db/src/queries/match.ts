import { createHash } from "node:crypto";
import type { MatchAiOutput, MatchTaskInput } from "@jobfilly/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { matchAiAnswers } from "../tables";

// Stored match.v1 answers (match_ai_answers, ARCHITECTURE › Data): each answer is kept under the
// role (message and position), the chosen CV and the hash of exactly what the model saw — the
// role's title and skills, the profile's target roles and skills, the chosen CV's skills. A rule,
// pay or policy change leaves the hash alone, so re-scoring after it finds the answer here and
// makes no model call (F3.5, F4.6); a new CV choice or a changed skill list makes a new hash.

/** The key of one stored answer. `cvId` null: no CV chosen. */
export interface MatchAnswerKey {
  messageId: string;
  position: number;
  cvId: string | null;
  inputHash: string;
}

/**
 * SHA-256 (hex) of what match.v1 sees of a role, in a fixed order: the role's title and skills,
 * the profile's target roles and skills, and the chosen CV's skills (CvChoiceResult.skills). The
 * role itself (message and position) is part of the key, not of the hash.
 */
export function matchInputHash(input: MatchTaskInput): string {
  const seen = [
    input.role.title,
    input.role.skills,
    input.profile.targetRoles,
    input.profile.skills,
    input.cvSkills,
  ];
  return createHash("sha256").update(JSON.stringify(seen)).digest("hex");
}

const keyFilter = (workspaceId: string, key: MatchAnswerKey) =>
  and(
    eq(matchAiAnswers.workspaceId, workspaceId),
    eq(matchAiAnswers.messageId, key.messageId),
    eq(matchAiAnswers.position, key.position),
    key.cvId === null ? isNull(matchAiAnswers.cvId) : eq(matchAiAnswers.cvId, key.cvId),
    eq(matchAiAnswers.inputHash, key.inputHash),
  );

/** The stored answer under exactly this key, or null. */
export async function getMatchAnswer(
  db: Database,
  workspaceId: string,
  key: MatchAnswerKey,
): Promise<MatchAiOutput | null> {
  const [row] = await db
    .select({ answer: matchAiAnswers.answer })
    .from(matchAiAnswers)
    .where(keyFilter(workspaceId, key))
    .limit(1);
  return row?.answer ?? null;
}

/**
 * Stores an answer under its key. Answers are never replaced: the same key always means the same
 * input, so a second answer (two replicas racing) is dropped and the first one kept.
 */
export async function saveMatchAnswer(
  db: Database,
  workspaceId: string,
  key: MatchAnswerKey,
  answer: MatchAiOutput,
  at: Date,
): Promise<void> {
  await db
    .insert(matchAiAnswers)
    .values({ workspaceId, ...key, answer, createdAt: at })
    .onConflictDoNothing();
}
