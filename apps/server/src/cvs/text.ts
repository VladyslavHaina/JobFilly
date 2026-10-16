import { Buffer } from "node:buffer";
import type { CvMediaType } from "@jobfilly/schema";
import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

// The text of an uploaded CV (F2.1), read in memory from its bytes: PDF through unpdf (PDF.js),
// DOCX through mammoth. Nothing is written to disk (F2.4): both take the bytes as they are.

/** What the bytes are, from their first bytes, whatever the file name says; null: neither. */
export function sniffCvType(bytes: Uint8Array): CvMediaType | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (starts([0x50, 0x4b, 0x03, 0x04])) return "docx"; // a zip, as every DOCX is
  return null;
}

/** The CV's text, or null when the file can't be read as its type. */
export async function extractCvText(
  mediaType: CvMediaType,
  bytes: Uint8Array,
): Promise<string | null> {
  try {
    if (mediaType === "pdf") {
      // PDF.js takes the buffer over, so it gets a copy.
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      try {
        const { text } = await extractPdfText(pdf, { mergePages: true });
        return text.trim();
      } finally {
        await pdf.loadingTask.destroy();
      }
    }
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value.trim();
  } catch {
    return null;
  }
}
