import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { link as judgeLink } from "../decisions/ask.js";
import { parse as parseSheet, type Sheet } from "../import/csv.js";
import { suggest } from "../import/map.js";
import * as store from "../store/index.js";
import { judgeSettings } from "./judge.js";

/**
 * Bringing in test cases someone already has.
 *
 * Plenty of teams arrive with a spreadsheet and no interest in designing
 * it again. They should be able to start from what they have and use
 * everything after the designing.
 *
 * What an import cannot conjure is the spine — the requirement and the
 * scenario each case came from. Where the file carries those references
 * they are kept; where it does not, the case comes in without them and
 * the screen says which parts of the app go quiet as a result. Inventing
 * a requirement per case so the matrices look full would be worse than
 * an honest gap.
 */

const PREVIEW = 8;

function readText(sourcePath: string): string {
  // A spreadsheet exported from Excel is not always valid UTF-8, and a
  // stray byte in one cell should not cost the whole import.
  return readFileSync(sourcePath).toString("utf8");
}

export interface Preview {
  columns: string[];
  rows: string[][];
  total: number;
  mapping: Record<string, number>;
  why: Record<number, string>;
  unmapped: string[];
  by: string;
  missing: string[];
  note: string;
}

export async function preview(projectPath: string, sourcePath: string): Promise<Preview> {
  const sheet: Sheet = parseSheet(readText(sourcePath));
  if (sheet.columns.length === 0) throw new Error("that file has no column headings to read");
  if (sheet.rows.length === 0) throw new Error("that file has headings but no rows");

  const suggested = await suggest({ ...judgeSettings(projectPath), sheet });
  const missing = (["title", "steps"] as const).filter(
    (field) => suggested.mapping[field] === undefined,
  );
  const traced =
    suggested.mapping.reqId !== undefined || suggested.mapping.scenarioId !== undefined;

  const note =
    missing.length > 0
      ? `Point ${missing.join(" and ")} at a column before importing.`
      : traced
        ? "The file carries its own requirement or scenario references, so coverage and risk will still work."
        : "Nothing in this file links a case to a requirement. They will import and go through validation, Gate B, suites, BDD and publishing — but coverage, risk and the TCER stay empty, because those are about requirements.";

  return {
    columns: sheet.columns,
    rows: sheet.rows.slice(0, PREVIEW),
    total: sheet.rows.length,
    mapping: suggested.mapping as Record<string, number>,
    why: suggested.why,
    unmapped: suggested.unmapped,
    by: suggested.by,
    missing,
    note,
  };
}

/**
 * P1/P2/P3 is the vocabulary everything downstream counts in, so a file
 * using High/Medium/Low is translated rather than carried through as a
 * fourth spelling nothing recognises.
 */
export function priorityOf(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (["p1", "1", "high", "critical", "blocker", "highest"].includes(value)) return "P1";
  if (["p3", "3", "low", "minor", "lowest", "trivial"].includes(value)) return "P3";
  // An unrecognised word is not evidence of importance either way.
  return "P2";
}

export function feasibilityOf(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return "";
  if (value.includes("partial") || value.includes("semi")) return "Partial";

  // Negations first. "Not automated" contains "automated", and reading
  // it as automatable would send a manual test to the automation pile.
  const denied =
    value.startsWith("not ") ||
    value.startsWith("non") ||
    value.includes("not auto") ||
    value.includes("no auto") ||
    value.includes("cannot") ||
    value.includes("can't");
  if (denied || value.includes("manual") || ["no", "false", "n", "none"].includes(value)) {
    return "Manual";
  }
  if (value.includes("auto") || ["yes", "true", "y"].includes(value)) return "Automatable";
  return "";
}

/**
 * Keeps the identifier a case already has, when it can be kept.
 *
 * These identifiers are in the team's bug reports and CI output, and
 * renumbering them would quietly break every reference.
 */
export function idFor(
  raw: string,
  position: number,
  taken: Set<string>,
): { id: string; why: string | null } {
  const candidate = raw.trim();
  const usable =
    candidate.length > 0 && candidate.length <= 64 && /^[A-Za-z0-9._-]+$/.test(candidate);

  if (usable && !taken.has(candidate)) return { id: candidate, why: null };

  const fresh = store.tcerId(position);
  if (candidate.length === 0) return { id: fresh, why: null };
  return {
    id: fresh,
    why: taken.has(candidate)
      ? `${candidate} was already taken, so it came in as ${fresh}`
      : `${candidate} could not be used as an identifier, so it came in as ${fresh}`,
  };
}

export interface Imported {
  added: number;
  skipped: number;
  renamed: string[];
  run: store.Run;
  note: string;
}

export function importCases(
  projectPath: string,
  sourcePath: string,
  mapping: Record<string, number>,
): Imported {
  for (const required of ["title", "steps"]) {
    if (mapping[required] === undefined) {
      throw new Error(`say which column holds the ${required} before importing`);
    }
  }

  const sheet = parseSheet(readText(sourcePath));
  const file = basename(sourcePath);
  const taken = new Set(store.cases.list(projectPath).map((item) => item.id));
  const version = new Map(store.requirements.list(projectPath).map((item) => [item.id, item.version]));

  const at = (row: string[], name: string): string => {
    const index = mapping[name];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  const runId = store.nextRunId(projectPath);
  let added = 0;
  let skipped = 0;
  const renamed: string[] = [];
  let position = store.nextNumber([...taken], "TC-");

  for (const row of sheet.rows) {
    const title = at(row, "title");
    // A row with no title is a spacer or a section heading, not a case.
    if (!title) {
      skipped += 1;
      continue;
    }

    const named = idFor(at(row, "id"), position, taken);
    if (named.why) renamed.push(named.why);
    taken.add(named.id);
    position += 1;

    const reqId = at(row, "reqId");
    const caseType = at(row, "caseType");
    store.cases.save(projectPath, {
      id: named.id,
      scenarioId: at(row, "scenarioId"),
      reqId,
      reqVersion: version.get(reqId) ?? 1,
      title,
      description: at(row, "description"),
      caseType: caseType || "Functional",
      priority: priorityOf(at(row, "priority")),
      precondition: at(row, "precondition"),
      testData: at(row, "testData"),
      steps: at(row, "steps"),
      expected: at(row, "expected"),
      platform: at(row, "platform"),
      autoFeasibility: feasibilityOf(at(row, "autoFeasibility")),
      state: "pending",
      decidedAt: null,
      comment: null,
      madeBy: { run: runId, model: "imported", prompt: "import/1", attempt: 1 },
      importedFrom: file,
      publishId: null,
      publishTarget: null,
      publishedAt: null,
    });
    added += 1;
  }

  const record: store.Run = {
    id: runId,
    kind: "import",
    startedAt: store.now(),
    finishedAt: store.now(),
    status: "finished",
    model: "imported",
    prompt: "import/1",
    batches: 1,
    batchesDone: 1,
    attempts: 1,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    produced: added,
    note: `${added} cases imported from ${file}${skipped > 0 ? `, ${skipped} rows had no title and were left out` : ""}`,
    judge: store.readJudgeMode(projectPath),
    pieces: [],
  };
  store.runs.save(projectPath, record);

  const linked = store.cases
    .list(projectPath)
    .filter((item) => item.importedFrom === file && item.reqId).length;

  const note =
    linked === added && added > 0
      ? "Every one came with a requirement reference, so coverage and risk have something to work with."
      : linked > 0
        ? `${linked} of ${added} came with a requirement reference. The rest will show as untraced.`
        : 'None of them reference a requirement, so they will fail the "no link to a scenario" check at validation and the coverage and risk screens stay empty. Everything else — Gate B, suites, BDD, feasibility, publishing — works as normal.';

  return { added, skipped, renamed, run: record, note };
}

/**
 * Works out which requirement each untraced case is a test of.
 *
 * Proposals only — nothing is written. A wrong link is worse than no
 * link, because it makes a requirement look tested when it is not.
 */
export async function proposeLinks(projectPath: string): Promise<unknown> {
  const untraced = store.cases.list(projectPath).filter((item) => !item.reqId.trim());
  if (untraced.length === 0) throw new Error("every case already traces to a requirement");

  const requirements = store.requirements.list(projectPath).filter((item) => !item.orphaned);
  if (requirements.length === 0) {
    throw new Error(
      "there are no requirements to link to — read a document first, or leave the cases untraced",
    );
  }

  return judgeLink({
    ...judgeSettings(projectPath),
    cases: untraced.map((item) => ({
      id: item.id,
      title: item.title,
      steps: item.steps,
      expected: item.expected,
    })),
    requirements: requirements.map((item) => ({
      id: item.id,
      title: item.title,
      acceptance: item.acceptance,
    })),
  });
}

/** Writes the links a person accepted, and nothing else. */
export function applyLinks(projectPath: string, links: Array<[string, string]>): number {
  const known = new Set(store.requirements.list(projectPath).map((item) => item.id));
  let linked = 0;

  for (const [caseId, reqId] of links) {
    if (!known.has(reqId)) throw new Error(`there is no requirement called ${reqId}`);
    const item = store.cases.get(projectPath, caseId);
    if (!item || item.reqId === reqId) continue;
    store.cases.save(projectPath, { ...item, reqId });
    linked += 1;
  }
  return linked;
}

/**
 * The one field a case does not already carry.
 *
 * First rule that matches wins. Crude, repeatable, and easy to argue
 * with. It stands in when nothing is judging; with Jev on, the judge
 * answers this at 88% and only falls back to here when it is unsure.
 */
export function classOf(title: string, expected: string): string {
  const text = `${title} ${expected}`.toLowerCase();
  const has = (words: string[]) => words.some((word) => text.includes(word));

  if (has(["unauthor", "permission", "injection", "xss", "csrf", "token", "privilege"])) {
    return "Security";
  }
  if (has(["boundary", "maximum", "minimum", "limit", "longest", "exceed", "one character", "zero"])) {
    return "Boundary";
  }
  if (has(["timeout", "unavailable", "network", "server error", "crash", "500"])) return "Error";
  if (has(["recover", "retry", "resume", "restore", "after a failure"])) return "Recovery";
  if (
    has([
      "invalid", "reject", "error", "fail", "denied", "blocked", "locked",
      "empty", "blank", "incorrect", "wrong", "not allowed", "cannot",
    ])
  ) {
    return "Negative";
  }
  return "Positive";
}

export interface Derived {
  scenarios: number;
  rows: number;
  judged: number;
  note: string;
}

/**
 * Builds the scenario and TCER row that each linked case implies.
 *
 * A projection, not an invention. A test case already carries a
 * precondition, an action and an expected result, which are a
 * scenario's own fields; the only thing genuinely inferred is the class.
 *
 * The scenarios arrive at Gate A pending, like any other. Marking them
 * approved would record a decision nobody made — the decision these
 * represent was made by whoever wrote the cases, not by this app.
 */
export async function deriveSpine(projectPath: string): Promise<Derived> {
  const waiting = store.cases
    .list(projectPath)
    .filter((item) => item.reqId.trim() && !item.scenarioId.trim());
  if (waiting.length === 0) {
    throw new Error(
      "every case that traces to a requirement already has a scenario — link some cases first",
    );
  }

  // One batched question per case for the class. Everything else on the
  // scenario is carried straight across.
  const judge = judgeSettings(projectPath);
  const classes = new Map<string, string>();
  if (judge["mode"] === "jev") {
    try {
      const { label } = await import("../decisions/ask.js");
      const answered = await label({
        ...judge,
        scenarios: waiting.map((item) => ({
          id: item.id,
          title: item.title,
          expected: item.expected,
        })),
      });
      for (const entry of answered.answers) {
        const picked = entry.answer.class;
        if (picked && picked.confidence >= 0.6) classes.set(entry.id, picked.value);
      }
    } catch {
      // A judge that cannot be reached costs accuracy on one field, not
      // the whole derivation.
    }
  }

  const runId = store.nextRunId(projectPath);
  let position = store.nextNumber(
    store.scenarios.list(projectPath).map((scenario) => scenario.id),
    "TS-",
  );

  const rows: store.TcerRow[] = [];
  let made = 0;

  for (const item of waiting) {
    const scenarioId = store.scenarioId(position);
    position += 1;

    const madeBy = {
      run: runId,
      model: `derived from ${item.id}`,
      prompt: "derive/1",
      attempt: 1,
    };
    // Not a summary — writing one would be composing content. The steps
    // are the action, so they are the trigger, verbatim.
    const trigger = item.steps.trim();

    store.scenarios.save(projectPath, {
      id: scenarioId,
      reqId: item.reqId,
      reqVersion: item.reqVersion,
      title: item.title,
      class: classes.get(item.id) ?? classOf(item.title, item.expected),
      priority: item.priority,
      autoFeasibility: item.autoFeasibility,
      precondition: item.precondition,
      trigger,
      expected: item.expected,
      state: "pending",
      decidedAt: null,
      comment: null,
      madeBy,
    });
    made += 1;

    rows.push({
      id: scenarioId,
      tcId: item.id,
      reqId: item.reqId,
      reqVersion: item.reqVersion,
      title: item.title,
      precondition: item.precondition,
      trigger,
      expected: item.expected,
      priority: item.priority,
      // The arithmetic fills these in; they are never asserted here.
      score: 0,
      verdict: "",
      reasons: [],
      removed: false,
      comment: null,
      madeBy,
    });

    // The case now knows which scenario it belongs to, which is what
    // the validation link check has been complaining about.
    store.cases.save(projectPath, { ...item, scenarioId });
  }

  const { scoreRows } = await import("../engines/tcer.js");
  const scored = scoreRows(rows as never);
  for (const row of rows) {
    const line = scored.rows.find((entry) => entry.tcId === row.tcId);
    if (line) {
      row.score = line.score;
      row.verdict = line.verdict;
      row.reasons = line.reasons;
    }
    store.tcer.save(projectPath, row);
  }

  store.runs.save(projectPath, {
    id: runId,
    kind: "derive",
    startedAt: store.now(),
    finishedAt: store.now(),
    status: "finished",
    model: "derived from the cases",
    prompt: "derive/1",
    batches: 1,
    batchesDone: 1,
    attempts: 1,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    produced: made,
    note: `${made} scenarios and ${rows.length} rows derived from imported cases${classes.size > 0 ? `, ${classes.size} classed by the judge` : ""}`,
    judge: store.readJudgeMode(projectPath),
    pieces: [],
  });

  return {
    scenarios: made,
    rows: rows.length,
    judged: classes.size,
    note: `Coverage, risk and the TCER now have something to work with. The ${made} scenarios are waiting at Gate A — they were derived, not designed, so nobody has approved them yet.`,
  };
}
