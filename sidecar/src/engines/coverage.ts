import type { Requirement, Scenario } from "./types.js";
import type { ScoredRow } from "./tcer.js";

export type CoverageLabel = "Covered" | "Partial" | "Gap";

export interface CoverageLine {
  reqId: string;
  title: string;
  source: string;
  scenarioIds: string[];
  caseIds: string[];
  caseCount: number;
  label: CoverageLabel;
  reason: string;
  /** How many of its rows were rejected at scoring — shown beside the label,
   *  because coverage itself deliberately ignores verdicts. */
  rejected: number;
}

export interface CoverageResult {
  lines: CoverageLine[];
  covered: number;
  partial: number;
  gap: number;
  percent: number;
}

/**
 * Covered means a test case exists, not that anything passed. Nothing in this
 * module has been executed, and the screen says so.
 */
export function buildCoverage(
  requirements: Requirement[],
  scenarios: Scenario[],
  rows: ScoredRow[],
): CoverageResult {
  const lines = requirements.map<CoverageLine>((requirement) => {
    const theirScenarios = scenarios.filter((scenario) => scenario.reqId === requirement.id);
    const theirRows = rows.filter((row) => row.reqId === requirement.id);
    const activeRows = theirRows.filter((row) => !row.removed);

    let label: CoverageLabel;
    let reason = "";
    if (theirScenarios.length === 0 && theirRows.length === 0) {
      label = "Gap";
      reason = "no scenario was generated";
    } else if (activeRows.length === 0) {
      label = "Partial";
      reason = theirRows.length > 0 ? "its rows were removed" : "a scenario exists but no row";
    } else {
      label = "Covered";
    }

    return {
      reqId: requirement.id,
      title: requirement.title,
      source: requirement.source,
      scenarioIds: theirScenarios.map((scenario) => scenario.id),
      caseIds: activeRows.map((row) => row.tcId),
      caseCount: activeRows.length,
      label,
      reason,
      rejected: activeRows.filter((row) => row.verdict === "Reject").length,
    };
  });

  const covered = lines.filter((line) => line.label === "Covered").length;

  return {
    lines,
    covered,
    partial: lines.filter((line) => line.label === "Partial").length,
    gap: lines.filter((line) => line.label === "Gap").length,
    percent: lines.length === 0 ? 0 : Math.round((covered / lines.length) * 100),
  };
}
