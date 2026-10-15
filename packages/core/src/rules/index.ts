// The rules engine (F3): the same input always gives the same outcome, with the rule that caused
// it; rules in plain words.
export {
  describeRule,
  evaluateCondition,
  evaluateRule,
  evaluateRules,
  type RuleOutcome,
  type RuleSubject,
  type RulesResult,
  ruleName,
} from "./engine";
