import type { TestCase } from "./types.js";

export type Automation = "Automatable" | "Partial" | "Manual";

export interface FeasibilityLine {
  id: string;
  title: string;
  automation: Automation;
  tool: string;
  value: "High" | "Medium" | "Low";
  why: string;
}

export interface FeasibilityResult {
  lines: FeasibilityLine[];
  automatable: number;
  partial: number;
  manual: number;
}

const TOOLS: Record<Automation, { tool: string; value: "High" | "Medium" | "Low" }> = {
  Automatable: { tool: "Playwright", value: "High" },
  Partial: { tool: "Manual plus API tests", value: "Medium" },
  Manual: { tool: "Manual", value: "Low" },
};

/**
 * First rule that matches wins.
 *
 * This only works because the scenario's own feasibility is carried onto the
 * case. The old app never copied it, so the first two rules could never fire
 * and nothing was ever classed Automatable.
 */
export function classifyCases(cases: TestCase[]): FeasibilityResult {
  const lines = cases.map<FeasibilityLine>((testCase) => {
    const declared = (testCase.autoFeasibility ?? "").toLowerCase();
    let automation: Automation;
    let why: string;

    if (declared.includes("auto")) {
      automation = "Automatable";
      why = "its scenario was marked automatable";
    } else if (declared.includes("partial")) {
      automation = "Partial";
      why = "its scenario was marked partly automatable";
    } else if (testCase.type === "BDD") {
      automation = "Automatable";
      why = "BDD cases run from their feature file";
    } else if (testCase.priority === "P1") {
      automation = "Partial";
      why = "high priority, but nothing says it can be automated";
    } else {
      automation = "Manual";
      why = "nothing indicates it can be automated";
    }

    return { id: testCase.id, title: testCase.title, automation, ...TOOLS[automation], why };
  });

  return {
    lines,
    automatable: lines.filter((line) => line.automation === "Automatable").length,
    partial: lines.filter((line) => line.automation === "Partial").length,
    manual: lines.filter((line) => line.automation === "Manual").length,
  };
}
