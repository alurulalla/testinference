import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { needsWork } from "./tcer.js";

const row = (precondition: string, trigger: string, expected: string) => ({
  id: "TS-01",
  title: "Login succeeds",
  precondition,
  trigger,
  expected,
});

describe("deciding what to pay for", () => {
  it("leaves a complete row alone", () => {
    assert.equal(needsWork(row("signed out", "sign in", "the dashboard opens")), false);
  });

  it("sends a row with any field missing", () => {
    assert.equal(needsWork(row("", "sign in", "the dashboard opens")), true);
    assert.equal(needsWork(row("signed out", "", "the dashboard opens")), true);
    assert.equal(needsWork(row("signed out", "sign in", "")), true);
  });

  it("treats whitespace as missing", () => {
    assert.equal(needsWork(row("   ", "sign in", "the dashboard opens")), true);
  });
});
