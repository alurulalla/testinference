import type { Feasibility, Priority, Scenario, ScenarioClass } from "./types.js";
import type { ScoredRow } from "./tcer.js";

/** Plain arithmetic, so anyone can check a ranking by hand. */
const PRIORITY: Record<Priority, number> = { P1: 3, P2: 2, P3: 1 };
const FEASIBILITY: Record<Feasibility, number> = { Manual: 3, Partial: 2, Automatable: 1 };
const CLASS: Record<ScenarioClass, number> = {
  Security: 3,
  Negative: 2,
  Boundary: 2,
  Error: 2,
  Recovery: 2,
  Positive: 1,
  Edge: 1,
};

export type Band = "P1" | "P2" | "P3";

export interface RankedScenario {
  rank: number;
  id: string;
  reqId: string;
  title: string;
  factors: string;
  arithmetic: string;
  score: number;
  band: Band;
  cycle: "C1" | "C2";
}

export interface RiskResult {
  ranked: RankedScenario[];
  bands: Record<Band, number>;
}

export function scoreScenario(scenario: Scenario): number {
  return (
    PRIORITY[scenario.priority] * 3 +
    FEASIBILITY[scenario.autoFeasibility] +
    CLASS[scenario.class]
  );
}

export function bandFor(score: number): Band {
  if (score >= 13) return "P1";
  if (score >= 9) return "P2";
  return "P3";
}

export function rankScenarios(scenarios: Scenario[]): RiskResult {
  const scored = scenarios.map((scenario, index) => {
    const score = scoreScenario(scenario);
    return { scenario, score, index };
  });

  // Stable: equal scores keep the order the scenarios were designed in.
  scored.sort((left, right) => right.score - left.score || left.index - right.index);

  const ranked = scored.map<RankedScenario>((entry, position) => {
    const band = bandFor(entry.score);
    return {
      rank: position + 1,
      id: entry.scenario.id,
      reqId: entry.scenario.reqId,
      title: entry.scenario.title,
      factors: `${entry.scenario.priority} · ${entry.scenario.autoFeasibility} · ${entry.scenario.class}`,
      arithmetic: `${PRIORITY[entry.scenario.priority] * 3} + ${FEASIBILITY[entry.scenario.autoFeasibility]} + ${CLASS[entry.scenario.class]}`,
      score: entry.score,
      band,
      // The top row always runs first, and so does everything in band P1.
      cycle: position === 0 || band === "P1" ? "C1" : "C2",
    };
  });

  return {
    ranked,
    bands: {
      P1: ranked.filter((row) => row.band === "P1").length,
      P2: ranked.filter((row) => row.band === "P2").length,
      P3: ranked.filter((row) => row.band === "P3").length,
    },
  };
}

export interface RequirementNeed {
  reqId: string;
  casesNow: number;
  casesRequired: number;
  band: Band;
  cycle: "C1" | "C2";
}

/**
 * How many cases a requirement ought to have: five for P1, three for P2.
 *
 * The old app showed the risk score in the "cases now" column when a
 * requirement had no rows, which read as nonsense — REQ-07 showed 6. Zero
 * rows means zero.
 */
export function requirementNeeds(risk: RiskResult, rows: ScoredRow[]): RequirementNeed[] {
  const byRequirement = new Map<string, RankedScenario>();
  for (const scenario of risk.ranked) {
    const best = byRequirement.get(scenario.reqId);
    if (!best || scenario.score > best.score) byRequirement.set(scenario.reqId, scenario);
  }

  return [...byRequirement.values()].map((scenario) => ({
    reqId: scenario.reqId,
    casesNow: rows.filter((row) => row.reqId === scenario.reqId && !row.removed).length,
    casesRequired: scenario.band === "P1" ? 5 : scenario.band === "P2" ? 3 : 1,
    band: scenario.band,
    cycle: scenario.cycle,
  }));
}
