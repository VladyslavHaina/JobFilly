// The shared contract. Every API payload, every AI structured output, job facts and the profile
// format are defined here once, one module per domain, and imported everywhere else.

export * from "./ai";
export * from "./ai-output";
export * from "./auth";
export * from "./common";
export * from "./events";
export * from "./facts";
export * from "./health";
export * from "./mailbox";
export * from "./messages";
export * from "./profile";
export * from "./scan";
export * from "./workspace";
