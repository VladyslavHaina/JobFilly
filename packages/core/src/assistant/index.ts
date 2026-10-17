// The assistant (F8): the impact preview of a proposal on the current roles, proposals and
// history lines in plain words, and (MVP 3) the pure parts of its read-only lookups.
export {
  knownSources,
  matchesWords,
  parseRoleRef,
  quotedLines,
  roleRef,
} from "./lookups";
export { type ImpactPreview, type PreviewRole, previewImpact } from "./preview";
export { changeLines, editedSummary, rewordEdited, rewordProposed } from "./words";
