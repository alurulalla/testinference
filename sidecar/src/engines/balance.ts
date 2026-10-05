import type { Scenario } from "./types.js";

/**
 * The coverage check that runs before Gate A.
 *
 * With Jev switched on this is a judgement call about whether a requirement
 * has enough scenarios. With it off, this rule stands in: a requirement that
 * can fail needs at least one scenario for it failing.
 */
export interface Balance {
  reqId: string;
  scenarios: number;
  hasPositive: boolean;
  hasNegative: boolean;
  note: string | null;
}

const NEGATIVE_CLASSES = new Set(["Negative", "Boundary", "Security", "Error", "Recovery"]);

export function checkBalance(
  requirementIds: string[],
  scenarios: Pick<Scenario, "reqId" | "class">[],
): Balance[] {
  return requirementIds.map((reqId) => {
    const theirs = scenarios.filter((scenario) => scenario.reqId === reqId);
    const hasPositive = theirs.some((scenario) => scenario.class === "Positive");
    const hasNegative = theirs.some((scenario) => NEGATIVE_CLASSES.has(scenario.class));

    let note: string | null = null;
    if (theirs.length === 0) note = "no scenarios";
    else if (!hasNegative) note = "nothing tests this failing";
    else if (!hasPositive) note = "nothing tests this working";

    return { reqId, scenarios: theirs.length, hasPositive, hasNegative, note };
  });
}
