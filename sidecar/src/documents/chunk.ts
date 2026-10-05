import { createHash } from "node:crypto";

/**
 * A piece of a document, with enough provenance to point a reviewer back at
 * the sentence it came from. The requirements export needs the source and
 * the anchor, so they are carried from the very first step rather than
 * reconstructed later.
 */
export interface Chunk {
  index: number;
  text: string;
  /** Page number for a PDF; null for formats that have no pages. */
  page: number | null;
  /** Which block in the document this piece starts at. */
  block: number;
  /** The nearest heading above it, when the format has headings. */
  heading: string | null;
  hash: string;
}

/** One paragraph, heading or page fragment, before pieces are assembled. */
export interface Block {
  text: string;
  page: number | null;
  heading: string | null;
  isHeading?: boolean;
}

const TARGET = 1200; // characters — a few hundred words
const HARD_MAX = 2000;

export function hashOf(text: string): string {
  return createHash("sha256").update(normalise(text)).digest("hex").slice(0, 16);
}

/** Whitespace differences are not changes, so they are removed before hashing. */
export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Groups blocks into pieces of roughly TARGET characters, never splitting a
 * block in half unless it is enormous on its own. A heading always starts a
 * new piece, so a requirement is never cut away from the section it belongs
 * to.
 */
export function toChunks(blocks: Block[]): Chunk[] {
  const chunks: Chunk[] = [];
  // The position in the original document travels with each block, because a
  // piece has to be able to say where it started.
  let buffer: Array<{ block: Block; at: number }> = [];
  let bufferLength = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const first = buffer[0]!;
    const text = buffer.map((entry) => entry.block.text).join("\n").trim();
    if (text.length > 0) {
      chunks.push({
        index: chunks.length,
        text,
        page: first.block.page,
        block: first.at,
        heading: first.block.heading,
        hash: hashOf(text),
      });
    }
    buffer = [];
    bufferLength = 0;
  };

  for (const [at, block] of blocks.entries()) {
    const clean = block.text.trim();
    if (clean.length === 0) continue;

    if (block.isHeading && buffer.length > 0) flush();

    if (bufferLength + clean.length > TARGET && buffer.length > 0) flush();

    if (clean.length > HARD_MAX) {
      // A single enormous block — a table or a wall of text. Split it on
      // sentence ends so the pieces stay readable.
      flush();
      for (const part of splitLong(clean)) {
        buffer.push({ block: { ...block, text: part }, at });
        flush();
      }
      continue;
    }

    buffer.push({ block: { ...block, text: clean }, at });
    bufferLength += clean.length;
  }

  flush();
  return chunks;
}

function splitLong(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > TARGET && current.length > 0) {
      parts.push(current.trim());
      current = "";
    }
    current += `${sentence} `;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}
