// The sender check (F5): message and domain signals, the verdict with its reasons, and the data
// files behind them. Pure logic, no I/O: the server does the lookups and reads the body.
export {
  type AppliedMark,
  checkSender,
  type DomainFacts,
  isFreeMailDomain,
  nameMatchesDomain,
  type SenderCheckInput,
  senderDomain,
  YOUNG_DOMAIN_DAYS,
} from "./check";
export { loadFreeMailDomains, loadMessageSignals } from "./data";
export { detectLanguage } from "./language";
