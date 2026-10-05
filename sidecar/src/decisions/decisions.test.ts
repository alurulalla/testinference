import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { gate, judgeSameByRule, judgeVagueByRule, review } from "./index.js";

describe("judging without a model", () => {
  it("calls a promise with no number vague", () => {
    const verdict = judgeVagueByRule("System should be fast under load", "Response time is acceptable");
    assert.equal(verdict.answer, true);
    assert.match(verdict.why, /without a number/);
  });

  it("accepts the same promise once it has a number", () => {
    const verdict = judgeVagueByRule(
      "System responds within 2 seconds under load",
      "95% of requests complete in under 2 seconds at 1000 users",
    );
    assert.equal(verdict.answer, false);
  });

  it("calls an empty acceptance vague", () => {
    assert.equal(judgeVagueByRule("User can log in", "works").answer, true);
  });

  it("spots two requirements that say the same thing", () => {
    const verdict = judgeSameByRule(
      "User can log in with username and password",
      "The user logs in using a username and a password",
    );
    assert.equal(verdict.answer, true);
  });

  it("does not merge two different requirements", () => {
    const verdict = judgeSameByRule(
      "User can log in with username and password",
      "Fare is deducted by concession card type",
    );
    assert.equal(verdict.answer, false);
  });
});

describe("what to do with a verdict", () => {
  it("acts only when it is sure", () => {
    assert.equal(gate(0.95, false), "act");
    assert.equal(gate(0.6, false), "verify");
    assert.equal(gate(0.2, false), "ask");
  });

  it("is stricter when the consequence is serious", () => {
    // The same confidence that would act on a label only verifies a deletion.
    assert.equal(gate(0.8, false), "act");
    assert.equal(gate(0.8, true), "verify");
  });
});

describe("reviewing a whole list", () => {
  const items = [
    { id: "REQ-01", title: "User can log in with username and password", acceptance: "Valid credentials reach the dashboard" },
    { id: "REQ-02", title: "The user logs in using a username and a password", acceptance: "Valid credentials reach the dashboard" },
    { id: "REQ-03", title: "Search should be fast", acceptance: "Results come back quickly" },
    { id: "REQ-04", title: "Fare is deducted by card type", acceptance: "A concession card is charged 50% of the adult fare" },
  ];

  it("finds the vague one and the repeated one, and pays nothing to do it", async () => {
    const result = (await review({ requirements: items, mode: "rules" })) as {
      asked: number;
      checked: number;
      findings: Array<{ kind: string; id: string; other: string | null }>;
      unsure: unknown[];
    };

    assert.equal(result.checked, 4);
    assert.equal(result.asked, 0, "rules mode must not call a model");

    const vague = result.findings.filter((finding) => finding.kind === "vague");
    assert.deepEqual(vague.map((finding) => finding.id), ["REQ-03"]);

    const duplicate = result.findings.filter((finding) => finding.kind === "duplicate");
    assert.equal(duplicate.length, 1);
    assert.deepEqual([duplicate[0]!.id, duplicate[0]!.other], ["REQ-01", "REQ-02"]);
  });

  it("leaves the clear, unique requirements alone", async () => {
    const result = (await review({ requirements: items, mode: "rules" })) as {
      findings: Array<{ id: string; other: string | null }>;
      unsure: Array<{ id: string; other: string | null }>;
    };
    const touched = new Set(
      [...result.findings, ...result.unsure].flatMap((finding) => [finding.id, finding.other]),
    );
    assert.equal(touched.has("REQ-04"), false);
  });
});
