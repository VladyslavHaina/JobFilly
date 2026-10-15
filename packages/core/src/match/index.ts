// The explainable match (F4): job facts against the profile's entries and rules, fits, conflicts
// or unknown with a reason, hard conflicts capping the score; match.v1's input for the fuzzy parts.
export {
  type MatchCv,
  type MatchRoleInput,
  matchRole,
  matchTaskInput,
  needsMatchAi,
  profileSkills,
  type RoleMatch,
} from "./match";
