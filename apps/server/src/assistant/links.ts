import { parseRoleRef, roleRef } from "@jobfilly/core";
import { decisionQuestions, getStoredMessages, listRoleStates } from "@jobfilly/db";
import {
  type AnswerSource,
  type AssistantLink,
  JOB_CATEGORIES,
  type MemberScope,
} from "@jobfilly/schema";
import type { AppDeps } from "../deps";

// An answer's links (MVP 3, F8.1): the refs it used, as stored with it, named for the page when
// the thread is read. A link is left out when what it points at is gone (a disconnected mailbox
// took its message) or the member may not see it now (D14: no drafts and no mail but job mail for
// a member who sees the pipeline only), so a link never opens a page that would answer 404.

/** "Senior Backend Engineer at Merlion Pay", as the mail names the role. */
function roleLabel(facts: { title: string | null; company: string | null }): string {
  const title = facts.title ?? "Untitled role";
  return facts.company ? `${title} at ${facts.company}` : title;
}

/** Every link of these sources, keyed by "<kind> <ref>"; a missing key is a link left out. */
export async function resolveLinks(
  deps: AppDeps,
  ws: string,
  scope: MemberScope,
  sources: readonly AnswerSource[],
): Promise<Map<string, AssistantLink>> {
  const full = scope === "everything";
  const roleRefs = sources
    .filter((s) => s.kind === "role" || (full && s.kind === "draft"))
    .map((s) => parseRoleRef(s.ref))
    .filter((r) => r !== null);
  const messageIds = sources.filter((s) => s.kind === "message").map((s) => s.ref);
  const groupKeys = sources.filter((s) => s.kind === "decision").map((s) => s.ref);
  const [roles, messages, questions] = await Promise.all([
    roleRefs.length > 0
      ? listRoleStates(deps.db, ws, { messageIds: [...new Set(roleRefs.map((r) => r.messageId))] })
      : [],
    getStoredMessages(deps.db, ws, [...new Set(messageIds)]),
    decisionQuestions(deps.db, ws, [...new Set(groupKeys)]),
  ]);
  const roleOf = new Map(roles.map((r) => [roleRef(r), r]));
  const links = new Map<string, AssistantLink>();
  for (const source of sources) {
    const key = `${source.kind} ${source.ref}`;
    if (source.kind === "role" || source.kind === "draft") {
      const role = roleOf.get(source.ref);
      if (!role || (source.kind === "draft" && !full)) continue;
      const label = roleLabel(role.facts);
      const at = { messageId: role.messageId, position: role.position };
      links.set(key, {
        kind: source.kind,
        label: source.kind === "draft" ? `Draft: ${label}` : label,
        ...at,
      });
    } else if (source.kind === "message") {
      const message = messages.find((m) => m.envelope.messageId === source.ref);
      const job = (JOB_CATEGORIES as readonly (string | null)[]).includes(
        message?.category ?? null,
      );
      if (!message || (!full && !job)) continue;
      links.set(key, {
        kind: "message",
        label: message.envelope.subject || "(no subject)",
        messageId: source.ref,
        position: null,
      });
    } else {
      const question = questions.get(source.ref);
      if (!question) continue;
      links.set(key, { kind: "decision", label: question, messageId: null, position: null });
    }
  }
  return links;
}

/** The links of one answer, in its sources' order. */
export function linksOf(
  sources: readonly AnswerSource[],
  links: Map<string, AssistantLink>,
): AssistantLink[] {
  return sources.flatMap((s) => links.get(`${s.kind} ${s.ref}`) ?? []);
}
