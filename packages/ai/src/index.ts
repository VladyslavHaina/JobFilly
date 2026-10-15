// The AI provider registry. Every model call in the app goes through here.
// Providers are equals: the user picks one, and each task (sorting,
// extraction, matching, drafting, embeddings) can use its own model.
// Structured output is always validated against a schema from @jobfilly/schema.
export {};
