import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { stepsMatchExpected } from "./cases.js";

describe("steps and their results", () => {
  it("line up when there are the same number of each", () => {
    assert.equal(stepsMatchExpected("1. a\n2. b", "1. x\n2. y"), true);
  });

  it("do not line up when one is short", () => {
    assert.equal(stepsMatchExpected("1. a\n2. b\n3. c", "1. x\n2. y"), false);
  });

  it("ignores blank lines", () => {
    assert.equal(stepsMatchExpected("1. a\n\n2. b\n", "1. x\n2. y"), true);
  });
});
