import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { localDir } from "./app.js";
import { atomicWrite } from "./paths.js";

/**
 * A document cut into pieces, and where each piece came from.
 *
 * Kept outside the project folder, beside the application's own data: a
 * document's full text can be megabytes, it is derived from a file the
 * team already has, and nobody wants it in a commit. What goes in the
 * project is the requirements it produced, and the fingerprint of the
 * piece each one came from.
 */
export interface Chunk {
  index?: number;
  hash: string;
  text: string;
  page: number | null;
  block: number;
  /** The nearest heading above it, when the format has headings. */
  heading?: string | null;
}

function file(projectId: string, documentId: string): string {
  return join(localDir(projectId, "index"), `${documentId}.jsonl`);
}

export function read(projectId: string, documentId: string): Chunk[] {
  const path = file(projectId, documentId);
  if (!existsSync(path)) return [];

  const chunks: Chunk[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      chunks.push(JSON.parse(line) as Chunk);
    } catch {
      // One unreadable line does not invalidate a document's index.
    }
  }
  return chunks;
}

export function write(projectId: string, documentId: string, chunks: Chunk[]): void {
  atomicWrite(
    file(projectId, documentId),
    chunks.map((chunk) => JSON.stringify(chunk)).join("\n") + "\n",
  );
}

/**
 * The fingerprint of a piece's text: the extractor's own, so a hash
 * computed here and one computed when the document was read agree. Two
 * implementations of one hash is how "unchanged" quietly becomes "new".
 */
export { hashOf as fingerprint } from "../documents/chunk.js";
