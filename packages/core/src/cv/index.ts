// CVs (F2): the skill check that drops any skill not found in the CV text, the tags a read
// suggests, and the CV choice per role with its reason. Pure logic, no I/O.
export { type CvCandidate, type CvChoiceInput, type CvChoiceOutcome, chooseCv } from "./choice";
export { checkSkills, type SkillCheck, tagsAfterRead } from "./skills";
