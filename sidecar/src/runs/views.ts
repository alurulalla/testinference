import { checkBalance } from "../engines/balance.js";
import { buildCoverage } from "../engines/coverage.js";
import { classifyCases } from "../engines/feasibility.js";
import { rankScenarios, requirementNeeds } from "../engines/risk.js";
import { validateCases } from "../engines/validation.js";
import { enough, verify } from "../decisions/ask.js";
import * as git from "../store/git.js";
import { count as countDecisions } from "../store/decisions.js";
import * as store from "../store/index.js";
import * as library from "../store/steps.js";
import { judgeSettings } from "./judge.js";
import { readiness } from "./judge.review.js";

/**
 * What the screens read: counts, rankings, coverage, validation.
 *
 * None of these write anything. Several feed the same rule engines the
 * app's published numbers come from, so the inputs are built here, once,
 * in the shape those engines were tested against.
 */

/** A scenario as the rule engines see it. */
function forEngines(scenario: store.Scenario, included: boolean) {
  return {
    id: scenario.id,
    reqId: scenario.reqId,
    title: scenario.title,
    class: scenario.class,
    priority: scenario.priority,
    autoFeasibility: scenario.autoFeasibility,
    included,
  };
}

export function summary(projectPath: string) {
  const requirements = store.requirements.list(projectPath);
  const scenarios = store.scenarios.list(projectPath);
  const rows = store.tcer.list(projectPath);
  const cases = store.cases.list(projectPath);
  const attempts = store.attempts.list(projectPath);
  const last = attempts[attempts.length - 1];

  return {
    documents: store.documents.count(projectPath),
    requirements: requirements.length,
    vague: requirements.filter((item) => item.flag === "vague").length,
    orphaned: requirements.filter((item) => item.orphaned).length,
    scenarios: scenarios.length,
    pendingGateA: scenarios.filter((item) => item.state === "pending").length,
    approvedScenarios: scenarios.filter((item) => item.state === "approved").length,
    rows: rows.filter((item) => !item.removed).length,
    cases: cases.length,
    pendingGateB: cases.filter((item) => item.state === "pending").length,
    approvedCases: cases.filter((item) => item.state === "approved").length,
    published: cases.filter((item) => item.publishId !== null).length,
    bdd: store.bdd.count(projectPath),
    steps: library.read(projectPath).length,
    decisions: countDecisions(projectPath),
    // For the status bar, so it reports what is switched on rather than
    // a string someone typed before Jev existed.
    judge: readiness(projectPath),
    git: git.status(projectPath),
    // The stages after publishing. Without these the strip and the cycle
    // on Home stop at Publish, which tells a reader the app ends there.
    pages: store.appPages.count(projectPath),
    plans: store.plans.count(projectPath),
    lastRun: last
      ? { passed: last.passed, failed: last.failed, unfinished: last.unfinished }
      : null,
  };
}

/** How many requirements have no scenarios yet — what a delta design would do. */
export function designPlan(projectPath: string) {
  const covered = new Set(store.scenarios.list(projectPath).map((item) => item.reqId));
  const requirements = store.requirements.list(projectPath);
  return {
    requirements: requirements.length,
    withScenarios: covered.size,
    toDesign: requirements.filter((item) => !item.orphaned && !covered.has(item.id)).length,
    orphaned: requirements.filter((item) => item.orphaned).length,
  };
}

/** Riskiest first, which requirements are missing a failure case, and which are not enough. */
export async function scenarioReview(projectPath: string) {
  const scenarios = store.scenarios.list(projectPath);
  const requirements = store.requirements.list(projectPath);
  // Rejected scenarios are out of the ranking, but still shown.
  const forRanking = scenarios.map((item) => forEngines(item, item.state !== "rejected"));

  const ranked = rankScenarios(forRanking as never);
  const balance = checkBalance(
    requirements.map((item) => item.id),
    forRanking as never,
  );

  // The same question again, but as judgement rather than counting: the
  // rule only knows whether a failing case exists, not whether the ones
  // written actually cover the requirement.
  const judged = await enough({
    ...judgeSettings(projectPath),
    requirements: requirements.map((item) => ({
      id: item.id,
      title: item.title,
      acceptance: item.acceptance,
    })),
    scenarios: forRanking,
  });

  return { ranked, balance, enough: judged };
}

export function coverage(projectPath: string) {
  const requirements = store.requirements.list(projectPath).map((item) => ({
    id: item.id,
    title: item.title,
    acceptance: item.acceptance,
    source: item.source.document,
  }));
  // Coverage counts approved scenarios only.
  const scenarios = store.scenarios.list(projectPath).map((item) => forEngines(item, item.state === "approved"));
  const rows = store.tcer.list(projectPath).map((row) => ({
    tcId: row.tcId,
    scenarioId: row.id,
    reqId: row.reqId,
    title: row.title,
    score: row.score,
    verdict: row.verdict,
    removed: row.removed,
  }));

  const risk = rankScenarios(scenarios as never);
  return {
    coverage: buildCoverage(requirements as never, scenarios as never, rows as never),
    risk,
    needs: requirementNeeds(risk, rows as never),
  };
}

/** The five checks. Rules only — no model is called. */
export function validate(projectPath: string) {
  return validateCases(
    store.cases.list(projectPath).map((item) => ({
      id: item.id,
      scenarioId: item.scenarioId,
      reqId: item.reqId,
      title: item.title,
      type: item.caseType,
      priority: item.priority,
      precondition: item.precondition,
      steps: item.steps,
      expected: item.expected,
      autoFeasibility: item.autoFeasibility,
    })) as never,
  );
}

/**
 * Does each case actually test the scenario it claims to?
 *
 * Deliberately separate from the five checks. Those count whether fields
 * are filled in, and their score is published arithmetic reproduced on
 * purpose — a sixth check folded in would change a number that is meant
 * to match. It is also the one question nothing can answer without a
 * judge: a case can pass all five checks and test the wrong thing.
 */
export async function verifyCases(projectPath: string) {
  const scenarios = store.scenarios.list(projectPath);
  const all = store.cases.list(projectPath);
  if (all.length === 0) throw new Error("there are no test cases to check yet");

  const judge = judgeSettings(projectPath);
  if (judge["mode"] !== "jev") {
    throw new Error("nothing can answer this without a judge — switch judgement to Jev in Settings");
  }

  return verify({
    ...judge,
    cases: all.map((item) => {
      const scenario = scenarios.find((entry) => entry.id === item.scenarioId);
      return {
        id: item.id,
        title: item.title,
        steps: item.steps,
        expected: item.expected,
        scenario: scenario ? { title: scenario.title, expected: scenario.expected } : null,
      };
    }),
  });
}

export function feasibility(projectPath: string) {
  return classifyCases(
    store.cases
      .list(projectPath)
      .filter((item) => item.state === "approved")
      .map((item) => ({
        id: item.id,
        title: item.title,
        type: item.caseType,
        priority: item.priority,
        autoFeasibility: item.autoFeasibility,
        scenarioId: item.scenarioId,
        reqId: item.reqId,
        precondition: item.precondition,
        steps: item.steps,
        expected: item.expected,
      })) as never,
  );
}
