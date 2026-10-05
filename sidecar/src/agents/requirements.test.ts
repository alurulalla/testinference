import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { estimateTokens, PROMPT_VERSION } from "./requirements.js";

describe("the reader", () => {
  it("has a prompt version, so an artifact can say what wrote it", () => {
    assert.match(PROMPT_VERSION, /^requirements@v\d+$/);
  });

  it("estimates tokens roughly from length", () => {
    assert.equal(estimateTokens("a".repeat(400)), 100);
    assert.equal(estimateTokens(""), 0);
  });
});
