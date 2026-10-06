import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Where a project keeps what it knows.
 *
 * The name is deliberate: when a project lives in a test repository, this
 * is the folder that gets committed. Everything in it is text, and every
 * file is one record, so a diff shows what actually changed rather than a
 * database blob.
 */
export const CONTEXT_DIR = ".testinference";

/** Created up front so the layout is identical everywhere, empty or not. */
export const FOLDERS = [
  "documents",
  "requirements",
  "scenarios",
  "tcer",
  "cases",
  "bdd",
  "steps",
  "suites",
  "runs",
  "discussions",
  "app",
  "plans",
  "results",
] as const;

export function contextDir(projectPath: string): string {
  return join(projectPath, CONTEXT_DIR);
}

export function folder(projectPath: string, name: string): string {
  return join(contextDir(projectPath), name);
}

/**
 * A write that either lands whole or does not land at all.
 *
 * Written to a temporary name beside the target and then renamed, because
 * rename is atomic on every filesystem we care about. A crash halfway
 * through leaves the old file intact rather than a half-written one, which
 * matters when the file is someone's approved test case.
 */
export function atomicWrite(target: string, text: string): void {
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });

  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text, "utf8");
    renameSync(temp, target);
  } catch (error) {
    // Never leave the temporary file behind to be mistaken for a record.
    try {
      rmSync(temp, { force: true });
    } catch {
      /* the original error is the one worth reporting */
    }
    throw error;
  }
}

/**
 * A name safe to use as a folder, from something a person typed.
 *
 * Anything that is not a letter or a number becomes a hyphen, so a project
 * called "Fare / Rules" cannot create a folder called "Rules" inside one
 * called "Fare".
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "project";
}
