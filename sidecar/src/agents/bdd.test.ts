import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { stepsOf, toFeatureFile, type DraftBdd } from "./bdd.js";

const entry: DraftBdd = {
  id: "TC-001",
  feature: "FarePayment",
  title: "Fare by concession type",
  given: "Given a <concession> card with balance\nAnd the reader is online",
  when: "When the card is tapped",
  then: "Then the fare is accepted",
  examples: "| concession |\n| Adult |\n| Senior |",
  testData: "",
  platform: "Device",
  newSteps: [],
};

describe("writing a feature file", () => {
  it("uses Scenario Outline when there is an Examples table", () => {
    const file = toFeatureFile("FarePayment", [entry]);
    assert.match(file, /Scenario Outline: Fare by concession type/);
    assert.match(file, /Examples:/);
    assert.match(file, /\| Adult \|/);
  });

  it("uses a plain Scenario when there is no table", () => {
    const file = toFeatureFile("FarePayment", [{ ...entry, examples: "" }]);
    assert.match(file, /Scenario: Fare by concession type/);
    assert.ok(!file.includes("Examples:"));
  });

  it("indents the steps under the scenario", () => {
    const file = toFeatureFile("FarePayment", [entry]);
    assert.match(file, /\n {4}Given a <concession> card with balance\n/);
    assert.match(file, /\n {4}And the reader is online\n/);
  });

  it("collects every step line for the library", () => {
    assert.deepEqual(stepsOf(entry), [
      "Given a <concession> card with balance",
      "And the reader is online",
      "When the card is tapped",
      "Then the fare is accepted",
    ]);
  });
});
