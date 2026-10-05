import type { TcerRow, Verdict } from "./types.js";

/**
 * Four checks, worth 25% each.
 *
 * They are presence checks, not quality measures, and are named here for what
 * they actually test rather than for what we might wish they tested.
 */
export interface Checks {
  hasResult: boolean;   // a title and an expected result
  hasAction: boolean;   // a trigger and an expected result
  resultIsReal: boolean; // the expected result is not empty
  traced: boolean;      // linked to a requirement
}

export interface ScoredRow {
  tcId: string;
  scenarioId: string;
  reqId: string;
  title: string;
  checks: Checks;
  score: number;
  verdict: Verdict;
  reasons: string[];
  removed: boolean;
}

export interface TcerResult {
  rows: ScoredRow[];
  average: number;
  pass: number;
  rework: number;
  reject: number;
  active: number;
}

const DUPLICATE_CAP = 60;

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function scoreRows(rows: TcerRow[]): TcerResult {
  const titleCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.title.trim().toLowerCase();
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }

  const scored = rows.map<ScoredRow>((row) => {
    const checks: Checks = {
      hasResult: filled(row.title) && filled(row.expected),
      hasAction: filled(row.trigger) && filled(row.expected),
      resultIsReal: filled(row.expected),
      traced: filled(row.reqId),
    };

    const passed = Object.values(checks).filter(Boolean).length;
    let score = (passed / 4) * 100;
    const reasons: string[] = [];

    if (!checks.hasResult) reasons.push("no title or no expected result");
    if (!checks.hasAction) reasons.push("no trigger or no expected result");
    if (!checks.resultIsReal) reasons.push("the expected result is empty");
    if (!checks.traced) reasons.push("not linked to a requirement");

    const duplicate = (titleCounts.get(row.title.trim().toLowerCase()) ?? 0) > 1;
    if (duplicate && score > DUPLICATE_CAP) {
      score = DUPLICATE_CAP;
      reasons.push("another row has the same title");
    }

    return {
      tcId: row.tcId,
      scenarioId: row.id,
      reqId: row.reqId,
      title: row.title,
      checks,
      score,
      verdict: verdictFor(score),
      reasons,
      removed: row.removed,
    };
  });

  // Rows an SME removed are not counted in anything.
  const active = scored.filter((row) => !row.removed);
  const total = active.reduce((sum, row) => sum + row.score, 0);

  return {
    rows: scored,
    average: active.length === 0 ? 0 : Math.round(total / active.length),
    pass: active.filter((row) => row.verdict === "Pass").length,
    rework: active.filter((row) => row.verdict === "Rework").length,
    reject: active.filter((row) => row.verdict === "Reject").length,
    active: active.length,
  };
}

export function verdictFor(score: number): Verdict {
  if (score >= 75) return "Pass";
  if (score >= 50) return "Rework";
  return "Reject";
}
