import { crc32 } from "node:zlib";

// The CV files of MVP 2, written by hand so e2e needs no PDF or Word library:
// - pdfDocument: a one-page PDF 1.4 with the standard Helvetica fonts (WinAnsiEncoding), an
//   uncompressed content stream and an exact cross-reference table;
// - docxDocument: a store-only (uncompressed) zip holding the three parts a WordprocessingML
//   reader needs: [Content_Types].xml, _rels/.rels and word/document.xml.
// Both are byte-for-byte reproducible: no timestamps, no ids, fixed zip dates.

/** One line of a CV: a heading (bold, larger) or body text; "" is an empty line. */
export interface DocLine {
  text: string;
  heading?: boolean;
}

const PAGE = { width: 595, height: 842, margin: 56 };
const LEADING = 15;
/** The most lines that fit on the one page. */
const PDF_MAX_LINES = Math.floor((PAGE.height - 2 * PAGE.margin) / LEADING);

/** A PDF string literal: ( ) \ escaped, characters outside ASCII as WinAnsi (Latin-1) octal. */
function pdfString(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code > 0xff) throw new Error(`"${char}" has no WinAnsiEncoding code: keep CV PDFs Latin-1`);
    if (char === "(" || char === ")" || char === "\\") out += `\\${char}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += char;
  }
  return `(${out})`;
}

/** A one-page PDF showing `lines` top to bottom. */
export function pdfDocument(lines: readonly DocLine[]): Buffer {
  if (lines.length > PDF_MAX_LINES) {
    throw new Error(`a CV PDF holds at most ${PDF_MAX_LINES} lines, not ${lines.length}`);
  }
  const ops = [`BT`, `${LEADING} TL`, `${PAGE.margin} ${PAGE.height - PAGE.margin} Td`];
  for (const line of lines) {
    ops.push(line.heading ? "/F2 12 Tf" : "/F1 10 Tf");
    if (line.text !== "") ops.push(`${pdfString(line.text)} Tj`);
    ops.push("T*");
  }
  ops.push("ET");
  const content = `${ops.join("\n")}\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
      "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const xmlText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The three parts of a minimal WordprocessingML document showing `lines` as paragraphs. */
function docxParts(lines: readonly DocLine[]): [string, string][] {
  const paragraphs = lines.map((line) => {
    if (line.text === "") return "<w:p/>";
    const props = line.heading ? '<w:rPr><w:b/><w:sz w:val="28"/></w:rPr>' : "";
    return `<w:p><w:r>${props}<w:t xml:space="preserve">${xmlText(line.text)}</w:t></w:r></w:p>`;
  });
  return [
    [
      "[Content_Types].xml",
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    ],
    [
      "_rels/.rels",
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    ],
    [
      "word/document.xml",
      `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>${paragraphs.join("")}<w:sectPr/></w:body></w:document>`,
    ],
  ];
}

/** 1980-01-01 00:00 in MS-DOS format, the earliest date a zip can hold. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** A store-only zip of `entries` (name, UTF-8 text), in order. */
function storedZip(entries: readonly [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by: 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A .docx file showing `lines` as paragraphs. */
export function docxDocument(lines: readonly DocLine[]): Buffer {
  return storedZip(docxParts(lines));
}
