// Pure logic for the decision inbox (F7): needs from match verdicts, ask_first rules and a draft's
// questions, grouped by group key; whether a role is drafted, asked about or held; and an answer
// as the profile item it adds, or words for the waiting roles only that write nothing.
export {
  type Answer,
  answerChange,
  answerItem,
  answerOf,
  itemFromText,
} from "./answers";
export {
  groupNeeds,
  isOpen,
  type NeedGroup,
  type NeedSource,
  needsFromQuestions,
  type RoleNeed,
  type RoleNeedsInput,
  roleNeeds,
} from "./needs";
export { planReply, type ReplyPlan, type ReplyPlanInput } from "./plan";
