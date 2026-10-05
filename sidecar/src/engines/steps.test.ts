import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { foldIn, matchStep, normalise } from "./steps.js";

describe("the step library", () => {
  it("ignores the keyword and the parameter name", () => {
    assert.equal(
      normalise("Given a <concession> card with sufficient balance"),
      normalise("And a <type> card with sufficient balance"),
    );
  });

  it("reuses a step that is the same thing said slightly differently", () => {
    const library = ["Given the user is on the login page"];
    const match = matchStep("When the user is on the login page", library);
    assert.equal(match.matched, library[0]);
  });

  it("does not reuse a step that means something else", () => {
    const library = ["Given the user is on the login page"];
    assert.equal(matchStep("Given the card reader is online", library).matched, null);
  });

  it("adds genuinely new steps and reuses the rest", () => {
    const update = foldIn(
      ["Given the user is on the login page", "Then the balance is reduced by the fare"],
      ["Given the user is on the login page"],
    );
    assert.equal(update.reused.length, 1);
    assert.deepEqual(update.added, ["Then the balance is reduced by the fare"]);
    assert.equal(update.library.length, 2);
  });

  it("keeps numbers out of the comparison, so 30 and 60 minutes are one step", () => {
    const library = ["Then the session expires after 30 minutes"];
    assert.ok(matchStep("Then the session expires after 60 minutes", library).matched);
  });
});
