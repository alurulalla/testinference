import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { classOf, feasibilityOf, idFor, priorityOf } from "./import.js";

describe("reading a spreadsheet someone else wrote", () => {
  it("translates priorities into the one vocabulary", () => {
    assert.equal(priorityOf("High"), "P1");
    assert.equal(priorityOf("  critical "), "P1");
    assert.equal(priorityOf("Low"), "P3");
    assert.equal(priorityOf("Medium"), "P2");
    // A word we do not know is not evidence either way, so it lands in
    // the middle rather than quietly becoming urgent.
    assert.equal(priorityOf("Showstopper-ish"), "P2");
  });

  it("does not read a denial as automatable", () => {
    assert.equal(feasibilityOf("Automated"), "Automatable");
    // "Not automated" contains "automated"; reading it the obvious way
    // sends a manual test to the automation pile.
    assert.equal(feasibilityOf("Not automated"), "Manual");
    assert.equal(feasibilityOf("No automation"), "Manual");
    assert.equal(feasibilityOf("non-automatable"), "Manual");
    assert.equal(feasibilityOf("Partially automated"), "Partial");
    assert.equal(feasibilityOf(""), "", "nothing said is not the same as manual");
  });

  it("keeps the identifier a case arrived with", () => {
    assert.deepEqual(idFor("QA-1041", 0, new Set()), { id: "QA-1041", why: null });
  });

  it("does not let an imported id overwrite a case that has it", () => {
    const named = idFor("TC-001", 7, new Set(["TC-001"]));
    assert.equal(named.id, "TC-008");
    assert.match(named.why ?? "", /already taken/);
  });

  it("replaces an identifier that could not be a filename", () => {
    assert.equal(idFor("../../etc/passwd", 2, new Set()).id, "TC-003");
  });
});

describe("the one field a derived scenario has to infer", () => {
  it("reads the case it came from", () => {
    assert.equal(classOf("User can sign in", "The dashboard loads"), "Positive");
    assert.equal(classOf("Locked out user is refused", "An error banner appears"), "Negative");
    assert.equal(classOf("Password one character short", "It is rejected"), "Boundary");
    // Security outranks the plain refusal every security test describes.
    assert.equal(classOf("Unauthorised access is rejected", "Error shown"), "Security");
  });
});
