/**
 * The worked example, run through every engine.
 *
 * Two sets of expectations. The first must match the published output of the
 * old app exactly — if one of those moves, we broke something. The second is
 * where we deliberately differ, and each one has a reason.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { requirements, scenarios, tcerRows, testCases } from "../fixture/worked-example.js";
import { scoreRows } from "./tcer.js";
import { buildCoverage } from "./coverage.js";
import { rankScenarios, requirementNeeds } from "./risk.js";
import { validateCases } from "./validation.js";
import { classifyCases } from "./feasibility.js";

const tcer = scoreRows(tcerRows);
const coverage = buildCoverage(requirements, scenarios, tcer.rows);
const risk = rankScenarios(scenarios);

describe("must match the published output", () => {
  it("scores the TCER rows", () => {
    assert.equal(tcer.active, 11, "eleven rows are active, one was removed");
    assert.equal(tcer.pass, 10);
    assert.equal(tcer.reject, 1);
    assert.equal(tcer.average, 93, "(10 x 100 + 25) / 11");
  });

  it("gives the rejected row 25%", () => {
    const empty = tcer.rows.find((row) => row.tcId === "TC-012");
    assert.equal(empty?.score, 25, "only the requirement link passes");
    assert.equal(empty?.verdict, "Reject");
  });

  it("builds coverage", () => {
    assert.equal(coverage.covered, 6);
    assert.equal(coverage.partial, 1);
    assert.equal(coverage.gap, 1);
    assert.equal(coverage.percent, 75);
  });

  it("counts a requirement as covered even when one of its rows was rejected", () => {
    const fare = coverage.lines.find((line) => line.reqId === "REQ-05");
    assert.equal(fare?.label, "Covered");
    assert.equal(fare?.rejected, 1, "and says so, rather than hiding it");
  });

  it("marks the vague requirement as a gap and the emptied one as partial", () => {
    assert.equal(coverage.lines.find((line) => line.reqId === "REQ-06")?.label, "Gap");
    assert.equal(coverage.lines.find((line) => line.reqId === "REQ-07")?.label, "Partial");
  });

  it("ranks the scenarios by risk", () => {
    assert.deepEqual(risk.bands, { P1: 2, P2: 8, P3: 2 });
    assert.deepEqual(
      risk.ranked.slice(0, 5).map((row) => [row.id, row.score]),
      [["TS-04", 13], ["TS-09", 13], ["TS-02", 12], ["TS-03", 12], ["TS-08", 12]],
    );
  });

  it("puts band P1 and the top row in the first cycle", () => {
    const first = risk.ranked.filter((row) => row.cycle === "C1").map((row) => row.id);
    assert.deepEqual(first, ["TS-04", "TS-09"]);
  });
});

describe("where we deliberately differ", () => {
  it("writes up ten cases, not eleven — the rejected row is skipped", () => {
    assert.equal(testCases.length, 11, "ten written plus one uploaded");
    assert.equal(testCases.filter((entry) => entry.scenarioId !== null).length, 10);
    assert.ok(!testCases.some((entry) => entry.id === "TC-012" && entry.scenarioId === "TS-12"));
  });

  it("validates the cases", () => {
    const validation = validateCases(testCases);
    assert.equal(validation.pass, 10);
    assert.equal(validation.rework, 0, "the weak case never reached validation");
    assert.equal(validation.reject, 1, "the uploaded legacy case");
  });

  it("scores the legacy case out of five rules, not four", () => {
    const validation = validateCases(testCases);
    const legacy = validation.lines.find((line) => line.id === "TC-012");
    assert.deepEqual(legacy?.issues, [
      "missing precondition",
      "fewer than two steps",
      "no link to a scenario",
    ]);
    assert.equal(legacy?.score, 40, "three of five rules failed");
    assert.equal(legacy?.verdict, "Reject");
  });

  it("classifies automation properly, because feasibility is carried over", () => {
    const published = testCases.filter((entry) => entry.scenarioId !== null);
    const feasibility = classifyCases(published);
    assert.equal(feasibility.automatable, 8, "the old app managed zero");
    assert.equal(feasibility.partial, 2);
    assert.equal(feasibility.manual, 0);
  });

  it("shows zero cases for a requirement that has none, not its risk score", () => {
    const needs = requirementNeeds(risk, tcer.rows);
    const audit = needs.find((need) => need.reqId === "REQ-07");
    assert.equal(audit?.casesNow, 0, "the old app printed 6 here");
  });
});

describe("the rules themselves", () => {
  it("caps a duplicate title at 60%, which forces a rework", () => {
    const twins = [tcerRows[0]!, { ...tcerRows[1]!, tcId: "TC-099", title: tcerRows[0]!.title }];
    const scored = scoreRows(twins);
    assert.equal(scored.rows[0]?.score, 60);
    assert.equal(scored.rows[0]?.verdict, "Rework");
  });

  it("ignores removed rows in every total", () => {
    const only = scoreRows([{ ...tcerRows[0]!, removed: true }]);
    assert.equal(only.active, 0);
    assert.equal(only.average, 0);
  });
});
