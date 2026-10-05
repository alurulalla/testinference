import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { log } from "../protocol.js";
import { toChunks, type Block, type Chunk } from "./chunk.js";

export interface Extracted {
  kind: "pdf" | "word" | "text" | "markdown";
  pages: number | null;
  chunks: Chunk[];
  /** Set when the file could be opened but holds no readable text. */
  warning: string | null;
}

export async function extract(params: Record<string, unknown>): Promise<Extracted> {
  const path = typeof params["path"] === "string" ? params["path"] : "";
  const pasted = typeof params["text"] === "string" ? params["text"] : null;

  if (pasted !== null) {
    return finish("text", null, fromPlainText(pasted));
  }
  if (!path) throw new Error("no file given");

  switch (extname(path).toLowerCase()) {
    case ".pdf":
      return extractPdf(path);
    case ".docx":
      return extractWord(path);
    case ".md":
    case ".markdown":
      return finish("markdown", null, fromMarkdown(await readFile(path, "utf8")));
    case ".txt":
    case "":
      return finish("text", null, fromPlainText(await readFile(path, "utf8")));
    default:
      throw new Error(`${extname(path)} files are not supported yet`);
  }
}

function finish(kind: Extracted["kind"], pages: number | null, blocks: Block[]): Extracted {
  const chunks = toChunks(blocks);
  return {
    kind,
    pages,
    chunks,
    warning: chunks.length === 0 ? "no readable text was found in this file" : null,
  };
}

async function extractPdf(path: string): Promise<Extracted> {
  // The legacy build is the one that runs outside a browser.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(path));
  const document = await pdfjs.getDocument({ data }).promise;

  const blocks: Block[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();

    // Items carry their position; a drop in vertical position means a new line.
    let line = "";
    let lastY: number | null = null;
    const lines: string[] = [];

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = Math.round(item.transform[5] as number);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (line.trim()) lines.push(line.trim());
        line = "";
      }
      line += item.str;
      if (item.hasEOL) {
        if (line.trim()) lines.push(line.trim());
        line = "";
      }
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());

    // Blank lines separate paragraphs; short lines in capitals read as headings.
    for (const text of groupLines(lines)) {
      blocks.push({ text, page: number, heading: null, isHeading: looksLikeHeading(text) });
    }
  }

  log(`read ${document.numPages} pages from ${path}`);
  return finish("pdf", document.numPages, withHeadings(blocks));
}

async function extractWord(path: string): Promise<Extracted> {
  const mammoth = await import("mammoth");
  const { value, messages } = await mammoth.convertToHtml({ path });
  for (const message of messages.slice(0, 3)) log(`word: ${message.message}`);

  const blocks: Block[] = [];
  const pattern = /<(h[1-6]|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const tag = match[1]!.toLowerCase();
    const text = stripTags(match[2] ?? "");
    if (!text) continue;
    blocks.push({ text, page: null, heading: null, isHeading: tag.startsWith("h") });
  }

  return finish("word", null, withHeadings(blocks));
}

function fromMarkdown(text: string): Block[] {
  const blocks: Block[] = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, page: null, heading: null, isHeading: part.startsWith("#") }));
  return withHeadings(blocks);
}

function fromPlainText(text: string): Block[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, page: null, heading: null }));
}

/** Gives every block the nearest heading above it. */
function withHeadings(blocks: Block[]): Block[] {
  let heading: string | null = null;
  return blocks.map((block) => {
    if (block.isHeading) {
      heading = block.text.replace(/^#+\s*/, "");
      return { ...block, heading };
    }
    return { ...block, heading };
  });
}

function groupLines(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    current.push(line);
    // A line ending in a full stop usually ends a paragraph in extracted PDFs.
    if (/[.!?:]$/.test(line) && current.join(" ").length > 120) {
      paragraphs.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs;
}

function looksLikeHeading(text: string): boolean {
  return text.length < 80 && !/[.!?]$/.test(text) && /^[0-9A-Z]/.test(text);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
