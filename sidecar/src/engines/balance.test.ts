import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { checkBalance } from "./balance.js";

const scenario = (reqId: string, klass: string) => ({ reqId, class: klass }) as never;

describe("the coverage check before Gate A", () => {
  it("is happy when a requirement can both work and fail", () => {
    const [line] = checkBalance(["REQ-01"], [scenario("REQ-01", "Positive"), scenario("REQ-01", "Negative")]);
    assert.equal(line?.note, null);
  });

  it("notices when nothing tests a requirement failing", () => {
    const [line] = checkBalance(["REQ-01"], [scenario("REQ-01", "Positive")]);
    assert.equal(line?.note, "nothing tests this failing");
  });

  it("counts a boundary or a security case as testing failure", () => {
    for (const klass of ["Boundary", "Security"]) {
      const [line] = checkBalance(["REQ-01"], [scenario("REQ-01", "Positive"), scenario("REQ-01", klass)]);
      assert.equal(line?.note, null, `${klass} should count`);
    }
  });

  it("reports a requirement with nothing at all", () => {
    const [line] = checkBalance(["REQ-06"], []);
    assert.equal(line?.scenarios, 0);
    assert.equal(line?.note, "no scenarios");
  });
});
