import { describe, expect, it } from "vitest";
import { docxWithText, pdfWithText } from "./test-files";
import { extractCvText, sniffCvType } from "./text";

// The CV text is read in memory with unpdf (PDF) and mammoth (DOCX), from real files.

describe("CV text", () => {
  it("reads a PDF's text", async () => {
    const bytes = pdfWithText(["Maria Santos", "Skills: Go, PostgreSQL (and Kubernetes)"]);
    expect(sniffCvType(bytes)).toBe("pdf");
    const text = await extractCvText("pdf", bytes);
    expect(text).toContain("Maria Santos");
    expect(text).toContain("Skills: Go, PostgreSQL (and Kubernetes)");
  });

  it("reads a DOCX's text", async () => {
    const bytes = docxWithText(["Maria Santos", "Kenntnisse: Go & PostgreSQL"]);
    expect(sniffCvType(bytes)).toBe("docx");
    expect(await extractCvText("docx", bytes)).toBe("Maria Santos\n\nKenntnisse: Go & PostgreSQL");
  });

  it("tells a file that is neither apart, and gives null for an unreadable one", async () => {
    expect(sniffCvType(new TextEncoder().encode("hello"))).toBeNull();
    expect(
      await extractCvText("docx", new TextEncoder().encode("PK\u0003\u0004 broken")),
    ).toBeNull();
    expect(await extractCvText("pdf", new TextEncoder().encode("%PDF-1.4 broken"))).toBeNull();
  });
});
