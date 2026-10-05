/**
 * The records the rule engines work on, and the controlled vocabularies they
 * depend on. These lists are small on purpose: the risk score and the
 * coverage join both key off them, and two spellings of the same word break
 * both quietly.
 */

export type Priority = "P1" | "P2" | "P3";
export type Feasibility = "Automatable" | "Partial" | "Manual";
export type ScenarioClass =
  | "Positive"
  | "Negative"
  | "Boundary"
  | "Security"
  | "Edge"
  | "Error"
  | "Recovery";
export type CaseType = "Functional" | "Regression" | "Smoke" | "Traditional" | "BDD";

export interface Requirement {
  id: string;
  title: string;
  acceptance: string;
  source: string;
}

export interface Scenario {
  id: string;
  reqId: string;
  title: string;
  class: ScenarioClass;
  priority: Priority;
  autoFeasibility: Feasibility;
  included: boolean;
}

export interface TcerRow {
  id: string;        // the scenario it came from
  tcId: string;      // the identity it keeps for the rest of its life
  reqId: string;
  title: string;
  trigger: string;
  expected: string;
  priority: Priority;
  removed: boolean;
}

export interface TestCase {
  id: string;
  scenarioId: string | null;
  reqId: string | null;
  title: string;
  type: CaseType;
  priority: Priority | null;
  precondition: string;
  steps: string;
  expected: string;
  autoFeasibility: Feasibility | null;
}

export type Verdict = "Pass" | "Rework" | "Reject";
