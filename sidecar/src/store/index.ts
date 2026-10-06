import { Records } from "./files.js";
import { readContext } from "./project.js";
import { DEFAULTS } from "./records.js";
import type {
  AppPage,
  Attempt,
  BddCase,
  Discussion,
  DocumentRecord,
  Plan,
  Requirement,
  Run,
  Scenario,
  Suite,
  TcerRow,
  TestCase,
} from "./records.js";

/**
 * The project's records.
 *
 * Each one used to be a file of its own in Rust, repeating the same four
 * operations. They are all the same thing — YAML files in a folder, named
 * by id — so they are all the same store with a different type.
 */
export const requirements = new Records<Requirement>("requirements", DEFAULTS.requirement);
export const scenarios = new Records<Scenario>("scenarios", DEFAULTS.scenario);
export const tcer = new Records<TcerRow>("tcer", DEFAULTS.tcerRow);
export const cases = new Records<TestCase>("cases", DEFAULTS.testCase);
export const bdd = new Records<BddCase>("bdd");
export const suites = new Records<Suite>("suites");
export const runs = new Records<Run>("runs", DEFAULTS.run);
export const documents = new Records<DocumentRecord>("documents");
export const plans = new Records<Plan>("plans");
export const attempts = new Records<Attempt>("results");
export const discussions = new Records<Discussion>("discussions", DEFAULTS.discussion);

/**
 * The map of the application.
 *
 * Its id is the address with the host stripped, because a project
 * explores one application and the path is what tells its pages apart.
 */
export const appPages = new Records<AppPage>("app", DEFAULTS.appPage);

export function pageId(url: string): string {
  const path = url.split("://")[1]?.split("/").slice(1).join("/") ?? "";
  const slug = path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "index";
}

export * from "./records.js";
export * from "./paths.js";
export { Records } from "./files.js";

/** `REQ-07` from position 6. The width is what keeps a list sorted. */
export function requirementId(position: number): string {
  return `REQ-${String(position + 1).padStart(2, "0")}`;
}

export function scenarioId(position: number): string {
  return `TS-${String(position + 1).padStart(2, "0")}`;
}

export function tcerId(position: number): string {
  return `TC-${String(position + 1).padStart(3, "0")}`;
}

/**
 * The next free number, read from the highest already used rather than
 * from how many there are. Imported records keep their own identifiers,
 * so the two are not the same and counting hands out one already taken.
 */
export function nextNumber(ids: string[], prefix: string): number {
  let highest = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const number = Number.parseInt(id.slice(prefix.length), 10);
    if (Number.isFinite(number) && number > highest) highest = number;
  }
  return highest;
}

/**
 * Which judgement mode a run happened under, for its record.
 *
 * Falls back to rules when the project cannot be read, because rules
 * never fail and a run record should not be lost over it.
 */
export function readJudgeMode(projectPath: string): string {
  try {
    return readContext(projectPath).judgeMode;
  } catch {
    return "rules";
  }
}

export function nextRunId(projectPath: string): string {
  return `run-${String(runs.count(projectPath) + 1).padStart(3, "0")}`;
}
