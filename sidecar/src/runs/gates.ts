import { rankScenarios } from "../engines/risk.js";
import { scoreRows } from "../engines/tcer.js";
import { record as recordDecision } from "../store/decisions.js";
import * as store from "../store/index.js";
import { atomicWrite } from "../store/paths.js";
import { join } from "node:path";

/**
 * Where a person decides, and what is kept of the deciding.
 *
 * A gate that only sets a flag on a record cannot answer "who approved
 * this, and what did it look like then?". Every decision here also goes
 * to the log, with the title as it was at that moment.
 */

/** Gate A: approve, reject, or put back to pending — recorded either way. */
export function decideScenarios(
  projectPath: string,
  ids: string[],
  verdict: string,
  comment: string | null,
): number {
  if (!["approved", "rejected", "pending"].includes(verdict)) {
    throw new Error(`${verdict} is not a verdict`);
  }

  let changed = 0;
  for (const id of ids) {
    const scenario = store.scenarios.get(projectPath, id);
    if (!scenario) continue;

    store.scenarios.save(projectPath, {
      ...scenario,
      state: verdict,
      decidedAt: store.now(),
      comment,
    });
    recordDecision(projectPath, {
      at: store.now(),
      gate: "A",
      subject: id,
      verdict,
      comment,
      title: scenario.title,
    });
    changed += 1;
  }
  return changed;
}

/** Gate B: approve, rework, reject, or put back. */
export function decideCases(
  projectPath: string,
  ids: string[],
  verdict: string,
  comment: string | null,
): number {
  if (!["approved", "rework", "rejected", "pending"].includes(verdict)) {
    throw new Error(`${verdict} is not a verdict`);
  }

  let changed = 0;
  for (const id of ids) {
    const item = store.cases.get(projectPath, id);
    if (!item) continue;

    store.cases.save(projectPath, {
      ...item,
      state: verdict,
      decidedAt: store.now(),
      // A decision with no comment does not erase an earlier one.
      comment: comment ?? item.comment,
    });
    recordDecision(projectPath, {
      at: store.now(),
      gate: "B",
      subject: item.id,
      verdict,
      comment,
      title: item.title,
    });
    changed += 1;
  }
  return changed;
}

/**
 * Takes a row out of scope, or puts it back, without deleting it.
 *
 * A removed row changes the average and the coverage, so everything is
 * scored again rather than patched.
 */
export function amendRow(
  projectPath: string,
  tcId: string,
  removed: boolean | null,
  comment: string | null,
): store.TcerRow[] {
  const row = store.tcer.list(projectPath).find((entry) => entry.tcId === tcId);
  if (!row) throw new Error(`no row called ${tcId}`);

  if (removed !== null) {
    row.removed = removed;
    recordDecision(projectPath, {
      at: store.now(),
      gate: "TCER",
      subject: tcId,
      verdict: removed ? "removed" : "restored",
      comment,
      title: row.title,
    });
  }
  if (comment !== null) row.comment = comment;
  store.tcer.save(projectPath, row);

  return rescore(projectPath);
}

/** Runs the four checks over every row. No model is involved. */
export function rescore(projectPath: string): store.TcerRow[] {
  const rows = store.tcer.list(projectPath);
  const scored = scoreRows(rows as never);
  for (const row of rows) {
    const line = scored.rows.find((entry) => entry.tcId === row.tcId);
    if (!line) continue;
    row.score = Math.round(line.score);
    row.verdict = line.verdict;
    row.reasons = line.reasons;
    store.tcer.save(projectPath, row);
  }
  return rows;
}

/**
 * Drops requirements whose paragraph has gone.
 *
 * A requirement someone has worked on is not the same as one the app
 * produced and the document then dropped. Its paragraph changed, but the
 * thinking in it was a person's, and a bulk tidy should not be how that
 * disappears.
 */
export function dropOrphans(projectPath: string, includeEdited: boolean): number {
  let dropped = 0;
  for (const requirement of store.requirements.list(projectPath)) {
    if (!requirement.orphaned) continue;
    const edited = requirement.editedBy.length > 0;
    if (edited && !includeEdited) continue;

    store.requirements.remove(projectPath, requirement.id);
    recordDecision(projectPath, {
      at: store.now(),
      gate: "requirements",
      subject: requirement.id,
      verdict: "dropped",
      comment: edited
        ? "its paragraph is no longer in the document, and it had been edited by hand"
        : "its paragraph is no longer in the document",
      title: requirement.title,
    });
    dropped += 1;
  }
  return dropped;
}

// ─── Suites ────────────────────────────────────────────────────────────────

/** The three standard suites always exist, even before anything is in them. */
export const DEFAULT_SUITES: Array<[string, string, string]> = [
  ["feature", "Feature suite", "everything approved for this build"],
  ["regression", "Regression suite", "the pack that runs on every build"],
  ["release", "Release suite", "the go or no-go set before shipping"],
];

export function listSuites(projectPath: string): store.Suite[] {
  const suites = store.suites.list(projectPath);
  for (const [id, name, purpose] of DEFAULT_SUITES) {
    if (!suites.some((suite) => suite.id === id)) suites.push({ id, name, purpose, cases: [] });
  }
  const order = (id: string) => {
    const at = DEFAULT_SUITES.findIndex(([known]) => known === id);
    return at === -1 ? 99 : at;
  };
  return suites.sort((left, right) => order(left.id) - order(right.id));
}

export function toggleSuite(projectPath: string, suiteId: string, caseId: string): store.Suite {
  const suite = listSuites(projectPath).find((entry) => entry.id === suiteId);
  if (!suite) throw new Error(`no suite called ${suiteId}`);

  const at = suite.cases.indexOf(caseId);
  if (at === -1) suite.cases = [...suite.cases, caseId].sort();
  else suite.cases = suite.cases.filter((id) => id !== caseId);

  store.suites.save(projectPath, suite);
  return suite;
}

/** Puts every approved case from one risk band into a suite. */
export function fillFromRisk(projectPath: string, suiteId: string, band: string): store.Suite {
  const ranked = rankScenarios(
    store.scenarios.list(projectPath).map((scenario) => ({
      id: scenario.id,
      reqId: scenario.reqId,
      title: scenario.title,
      class: scenario.class,
      priority: scenario.priority,
      autoFeasibility: scenario.autoFeasibility,
      included: scenario.state === "approved",
    })) as never,
  );
  const wanted = new Set(ranked.ranked.filter((entry) => entry.band === band).map((entry) => entry.id));

  const suite = listSuites(projectPath).find((entry) => entry.id === suiteId);
  if (!suite) throw new Error(`no suite called ${suiteId}`);

  for (const item of store.cases.list(projectPath)) {
    if (item.state === "approved" && wanted.has(item.scenarioId) && !suite.cases.includes(item.id)) {
      suite.cases.push(item.id);
    }
  }
  suite.cases.sort();
  store.suites.save(projectPath, suite);
  return suite;
}

// ─── Publishing ────────────────────────────────────────────────────────────

/**
 * Sends the approved cases out, and records a receipt on each.
 *
 * What leaves the app is a file in the project's exports folder; an
 * integration with an ALM tool consumes that file. The receipt is stored
 * on the case so publishing again updates rather than duplicates.
 */
export function publish(projectPath: string, target: string) {
  const stamp = store.now();
  const short = stamp.replace(/\D/g, "").slice(0, 8);
  const label = target.toUpperCase();

  const rows: Array<{ id: string; title: string; receipt: string }> = [];
  for (const [position, item] of store.cases.list(projectPath).entries()) {
    if (item.state !== "approved") continue;

    const receipt = `${label}-${short}-${String(position + 1).padStart(3, "0")}`;
    store.cases.save(projectPath, {
      ...item,
      publishId: receipt,
      publishTarget: target,
      publishedAt: stamp,
    });
    rows.push({ id: item.id, title: item.title, receipt });
  }
  if (rows.length === 0) throw new Error("no approved cases to publish");

  const file = join(projectPath, ".testinference", "exports", `publish-${short}.json`);
  atomicWrite(file, JSON.stringify({ target, publishedAt: stamp, cases: rows }, null, 2));
  return { published: rows.length, target, file };
}

// ─── Exports ───────────────────────────────────────────────────────────────

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

/**
 * The wider export — the screen shows four columns, this carries ten,
 * including the source and the anchor.
 */
export function exportRequirements(projectPath: string): string {
  const lines = ["ID,Title,Acceptance,Source,Page,Anchor,Domain,Impacted,Flag,Clarification"];
  for (const item of store.requirements.list(projectPath)) {
    lines.push(
      [
        item.id,
        item.title,
        item.acceptance,
        item.source.document,
        item.source.page === null ? "" : String(item.source.page),
        `block ${item.source.block}`,
        item.domain,
        item.impacted,
        item.flag,
        item.clarification ?? "",
      ]
        .map(quote)
        .join(","),
    );
  }

  const file = join(projectPath, ".testinference", "exports", "requirements.csv");
  atomicWrite(file, `${lines.join("\n")}\n`);
  return file;
}
