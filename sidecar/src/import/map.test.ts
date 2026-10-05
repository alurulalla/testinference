import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parse } from "./csv.js";
import { byName } from "./map.js";

describe("working out which column is which", () => {
  it("recognises the names teams actually use", () => {
    const sheet = parse(
      "Test Case ID,Summary,Pre-requisites,Test Steps,Expected Result,Severity\n" +
        "TC-1,Log in,On the login page,Enter the password,Logged in,High\n",
    );
    const { mapping } = byName(sheet);
    assert.deepEqual(mapping, {
      id: 0,
      title: 1,
      precondition: 2,
      steps: 3,
      expected: 4,
      priority: 5,
    });
  });

  it("ignores punctuation and case in a heading", () => {
    const { mapping } = byName(parse("expected_result,TEST STEPS\na,b\n"));
    assert.deepEqual(mapping, { expected: 0, steps: 1 });
  });

  it("leaves the first claim standing when two columns want one field", () => {
    const sheet = parse("Title,Name\nOne,Two\n");
    const { mapping, unmapped } = byName(sheet);
    assert.equal(mapping.title, 0, "the first column keeps the field");
    assert.deepEqual(unmapped, ["Name"]);
  });

  it("reports what it could not place rather than guessing", () => {
    const sheet = parse("Title,Steps,Notes,Owner\na,b,c,d\n");
    const { mapping, unmapped } = byName(sheet);
    assert.deepEqual(mapping, { title: 0, steps: 1 });
    assert.deepEqual(unmapped, ["Notes", "Owner"]);
  });
});
