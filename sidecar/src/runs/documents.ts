import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { extract } from "../documents/extract.js";
import { localDir } from "../store/app.js";
import { read as readChunks, write as writeChunks } from "../store/chunks.js";
import * as store from "../store/index.js";
import { readContext } from "../store/project.js";
import { slugify } from "../store/paths.js";

/**
 * Reading a document, cutting it into pieces, and remembering it.
 *
 * The file is copied to this machine's own library and the pieces are
 * indexed locally. Only a fingerprint and the counts go into the project
 * folder: the document itself is confidential and the index can be
 * rebuilt, so neither belongs in a commit.
 */

/** The first 16 characters of a SHA-256, exactly as the records on disk have it. */
export function fingerprintOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

export interface DocumentAdded {
  outcome: "added" | "replaced" | "unchanged";
  record: store.DocumentRecord;
}

export async function add(projectPath: string, sourcePath: string): Promise<DocumentAdded> {
  if (!existsSync(sourcePath)) throw new Error(`could not read the file: ${sourcePath} is not there`);

  const bytes = readFileSync(sourcePath);
  const fingerprint = fingerprintOf(bytes);
  const context = readContext(projectPath);

  // The same bytes again is not a change, whatever the file is called.
  const existing = store.documents.list(projectPath).find((item) => item.fingerprint === fingerprint);
  if (existing) return { outcome: "unchanged", record: existing };

  const name = basename(sourcePath);
  const id = slugify(name);
  const replacing = store.documents.get(projectPath, id) !== null;

  const library = localDir(context.id, "library");
  const copy = join(library, `${fingerprint}.${extname(sourcePath).slice(1) || "bin"}`);
  if (!existsSync(copy)) copyFileSync(sourcePath, copy);

  const extracted = await extract({ path: copy });
  writeChunks(context.id, id, extracted.chunks);

  const record: store.DocumentRecord = {
    id,
    name,
    kind: extracted.kind,
    pages: extracted.pages,
    chunks: extracted.chunks.length,
    bytes: statSync(sourcePath).size,
    fingerprint,
    addedAt: store.now(),
    warning: extracted.warning,
  };
  store.documents.save(projectPath, record);

  return { outcome: replacing ? "replaced" : "added", record };
}

export function chunks(projectPath: string, documentId: string, limit: number) {
  const context = readContext(projectPath);
  return readChunks(context.id, documentId).slice(0, limit);
}
