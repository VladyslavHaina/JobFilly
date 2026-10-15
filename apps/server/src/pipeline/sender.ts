import type { SenderStage } from "./stages";

// The sender stage (F5): signals from the message body (the phrase lists in packages/core) and
// from the domain (deps.domains), with the editor's marks. Written by the cvs-senders slice; until
// then it fails, so every check stays missing and no reply is made without one.
export const senderStage: SenderStage = async () => {
  throw new Error("the sender stage is written by the cvs-senders slice");
};
