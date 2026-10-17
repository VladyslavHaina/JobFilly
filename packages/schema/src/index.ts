// The shared contract. Every API payload, every AI structured output, job facts and the profile
// format are defined here once, one module per domain, and imported everywhere else.

export * from "./ai";
export * from "./ai-output";
export * from "./applications";
export * from "./assistant";
export * from "./auth";
export * from "./common";
export * from "./cv";
export * from "./decisions";
export * from "./drafts";
export * from "./events";
export * from "./facts";
export * from "./health";
export * from "./jobs";
export * from "./mailbox";
export * from "./match";
export * from "./messages";
export * from "./oauth";
export * from "./profile";
export * from "./rules";
export * from "./scan";
export * from "./send";
export * from "./sender";
export * from "./sync";
export * from "./workspace";
