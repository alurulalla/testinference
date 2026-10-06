import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { folder } from "./paths.js";

/**
 * Every human decision, appended and never rewritten.
 *
 * This is the audit trail. A gate that only sets a flag on a record
 * cannot answer "who approved this, and what did it look like then?".
 * One file per day, one line per decision, so it appends cheaply and
 * reads in a terminal.
 */
export interface Decision {
  at: string;
  /** A · B · requirements · TCER · assistant */
  gate: string;
  subject: string;
  verdict: string;
  comment: string | null;
  /** What the artifact said at the moment it was decided. */
  title: string | null;
}

function dir(projectPath: string): string {
  return folder(projectPath, "decisions");
}

export function record(projectPath: string, decision: Decision): void {
  const target = dir(projectPath);
  mkdirSync(target, { recursive: true });

  const day = decision.at.slice(0, 10) || "undated";
  appendFileSync(join(target, `${day}.jsonl`), `${JSON.stringify(decision)}\n`, "utf8");
}

export function list(projectPath: string): Decision[] {
  const target = dir(projectPath);
  if (!existsSync(target)) return [];

  const found: Decision[] = [];
  for (const name of readdirSync(target).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(target, name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        found.push(JSON.parse(line) as Decision);
      } catch {
        // One unreadable line does not invalidate the day's record.
      }
    }
  }
  return found;
}

export function count(projectPath: string): number {
  const target = dir(projectPath);
  if (!existsSync(target)) return 0;

  let total = 0;
  for (const name of readdirSync(target)) {
    if (!name.endsWith(".jsonl")) continue;
    total += readFileSync(join(target, name), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
  }
  return total;
}
