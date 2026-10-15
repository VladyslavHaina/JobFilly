// Domain logic: the scan's decisions, intake aggregation, profile changes, the reply policy, and
// from MVP 2's slices CVs, the sender check, rules, matching, drafts, decisions and the assistant.
// Pure functions over data defined in @jobfilly/schema: no network, disk, mail or AI calls here,
// so every rule is testable alone.

export * from "./assistant/index";
export * from "./cv/index";
export * from "./decisions/index";
export * from "./drafts/index";
export * from "./intake/index";
export * from "./match/index";
export * from "./policy/index";
export * from "./profile/index";
export * from "./rules/index";
export * from "./scan/index";
export * from "./sender/index";
