import type { TestCase, Verdict } from "./types.js";

export const RULES = [
  "missing expected result",
  "missing precondition",
  "fewer than two steps",
  "no link to a scenario",
  "duplicate title",
] as const;

export interface ValidationLine {
  id: string;
  title: string;
  issues: string[];
  score: number;
  verdict: Verdict;
}

export interface ValidationResult {
  lines: ValidationLine[];
  pass: number;
  rework: number;
  reject: number;
}

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function stepCount(steps: string): number {
  return steps
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

/**
 * Five rules, and the score is divided by five. The old app divided by four
 * while having five rules, so a case failing all of them scored below zero.
 */
export function validateCases(cases: TestCase[]): ValidationResult {
  const titleCounts = new Map<string, number>();
  for (const testCase of cases) {
    const key = testCase.title.trim().toLowerCase();
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }

  const lines = cases.map<ValidationLine>((testCase) => {
    const issues: string[] = [];
    if (!filled(testCase.expected)) issues.push(RULES[0]);
    if (!filled(testCase.precondition)) issues.push(RULES[1]);
    if (stepCount(testCase.steps) < 2) issues.push(RULES[2]);
    if (!filled(testCase.scenarioId)) issues.push(RULES[3]);
    if ((titleCounts.get(testCase.title.trim().toLowerCase()) ?? 0) > 1) issues.push(RULES[4]);

    const score = Math.round((1 - issues.length / RULES.length) * 100);
    const verdict: Verdict = issues.length === 0 ? "Pass" : issues.length === 1 ? "Rework" : "Reject";

    return { id: testCase.id, title: testCase.title, issues, score, verdict };
  });

  return {
    lines,
    pass: lines.filter((line) => line.verdict === "Pass").length,
    rework: lines.filter((line) => line.verdict === "Rework").length,
    reject: lines.filter((line) => line.verdict === "Reject").length,
  };
}
