// Domain logic: the scan's decisions, intake aggregation, and later profiles, rules and matching.
// Pure functions over data defined in @jobfilly/schema: no network, disk, mail or AI calls here,
// so every rule is testable alone.

export * from "./intake/index";
export * from "./scan/index";
