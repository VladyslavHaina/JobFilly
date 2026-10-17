// The profile's change semantics and the decision inbox's "already answered" (F7.6, F8), pure.
// MVP 3: how many roles a change by hand changes (F2.3).

export {
  type AppliedChanges,
  answeredFor,
  applyChanges,
  type ChangeContext,
  type ChangeError,
  type ProfileContent,
  restoreChanges,
  restoreSnapshot,
} from "./changes";
export { countChangedRoles } from "./impact";
