import { MAIL_SEND_JOB, MailSendPayloadSchema } from "@jobfilly/schema";
import { defineJob, type JobRegistry } from "../jobs/queue";

// mail.send (MVP 3, F4.2): sends one confirmed message once its Undo delay is over (the job's
// run_at), unless Undo cancelled it. Built by the send slice; until then nothing enqueues it.

export const sendJobs: JobRegistry = {
  [MAIL_SEND_JOB]: defineJob(MailSendPayloadSchema, async () => {
    throw new Error("mail.send is not built yet (MVP 3, send slice)");
  }),
};
