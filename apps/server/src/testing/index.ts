// Helpers for every server test: dependencies on PGlite with fakes at the ports (the mailbox, the
// AI, the domain lookups), seeding through the workspace-scoped @jobfilly/db functions, and
// requests sent as a signed-in browser would; and real PDF and DOCX files to upload. The slices'
// tests use these doubles. The foundation owns them; a slice adds one here only when tests in more
// than one of its folders need it, and says why in the commit that adds it.
export * from "./ai";
export * from "./clock";
export { docxWithText, pdfWithText } from "./cv-files";
export * from "./deps";
export * from "./http";
export * from "./mailbox";
export * from "./oauth";
export * from "./pipeline";
export * from "./seed";
export * from "./smtp";
