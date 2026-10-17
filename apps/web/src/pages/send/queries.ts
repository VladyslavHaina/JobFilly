import {
  MailboxListSchema,
  MailPresetListSchema,
  SendPreviewSchema,
  SendSchema,
  type SmtpSettingsInput,
  SmtpSettingsViewSchema,
  SmtpTestResultSchema,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { queryKeys } from "../../hooks";
import { apiPaths } from "../../paths";

// The sending API (F4): the confirmation of one draft, confirming it, Undo, and a mailbox's SMTP
// settings. Sending changes a draft, so each mutation waits until the drafts are fetched again:
// the card then shows the send's own state (waiting with Undo, sent, failed).

const sendPath = (workspaceId: string, draftId: string) =>
  `${apiPaths.workspace(workspaceId)}/drafts/${draftId}/send`;
const mailboxesPath = (workspaceId: string) => `${apiPaths.workspace(workspaceId)}/mailboxes`;

/** The confirmation of one draft, made fresh each time it opens (its token is for this content). */
export function useSendPreview(workspaceId: string, draftId: string, open: boolean) {
  return useQuery({
    queryKey: [...queryKeys.area(workspaceId, "sends"), "preview", draftId],
    queryFn: () => api(sendPath(workspaceId, draftId), SendPreviewSchema),
    enabled: open,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

function useSendMutation<V>(workspaceId: string, request: (vars: V) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "drafts") }),
  });
}

/** Confirms the draft with the confirmation's token: it leaves after the Undo delay. */
export function useConfirmSend(workspaceId: string, draftId: string) {
  return useSendMutation(workspaceId, (token: string) =>
    api(sendPath(workspaceId, draftId), SendSchema, { method: "POST", body: { token } }),
  );
}

/** Undo while the send waits. */
export function useUndoSend(workspaceId: string, draftId: string) {
  return useSendMutation(workspaceId, () =>
    api(sendPath(workspaceId, draftId), SendSchema, { method: "DELETE" }),
  );
}

const mailboxArea = (workspaceId: string) => queryKeys.area(workspaceId, "mailbox");

export function useMailboxes(workspaceId: string) {
  return useQuery({
    queryKey: [...mailboxArea(workspaceId), "list"],
    queryFn: () => api(mailboxesPath(workspaceId), MailboxListSchema),
  });
}

export function useMailPresets(workspaceId: string) {
  return useQuery({
    queryKey: [...mailboxArea(workspaceId), "presets"],
    queryFn: () => api(`${mailboxesPath(workspaceId)}/presets`, MailPresetListSchema),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

const smtpPath = (workspaceId: string, mailboxId: string) =>
  `${mailboxesPath(workspaceId)}/${mailboxId}/smtp`;
const smtpKey = (workspaceId: string, mailboxId: string) =>
  [...mailboxArea(workspaceId), "smtp", mailboxId] as const;

export function useSmtpSettings(workspaceId: string, mailboxId: string) {
  return useQuery({
    queryKey: smtpKey(workspaceId, mailboxId),
    queryFn: () => api(smtpPath(workspaceId, mailboxId), SmtpSettingsViewSchema),
  });
}

export function useSaveSmtp(workspaceId: string, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SmtpSettingsInput) =>
      api(smtpPath(workspaceId, mailboxId), SmtpSettingsViewSchema, { method: "PUT", body: input }),
    onSuccess: (view) => client.setQueryData(smtpKey(workspaceId, mailboxId), view),
  });
}

export function useTestSmtp(workspaceId: string, mailboxId: string) {
  return useMutation({
    mutationFn: (input: SmtpSettingsInput) =>
      api(`${smtpPath(workspaceId, mailboxId)}/test`, SmtpTestResultSchema, {
        method: "POST",
        body: input,
      }),
  });
}
