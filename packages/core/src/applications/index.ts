// The application pipeline (MVP 3, F5): stages derived from the mail, a stage set by hand winning,
// the no-reply flag and the same role from several senders as one item. Pure logic, no I/O.
export {
  buildPipeline,
  type ManualStageInput,
  type PipelineInput,
  type PipelineMailInput,
  type PipelineRoleInput,
  type PipelineSentInput,
} from "./pipeline";
