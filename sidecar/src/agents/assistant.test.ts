import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { isDestructive, PROMPT_VERSION } from "./assistant.js";

describe("the assistant", () => {
  it("knows which proposals destroy something", () => {
    assert.equal(isDestructive("delete_requirements"), true);
    assert.equal(isDestructive("remove_tcer"), true);
    assert.equal(isDestructive("decide_scenarios"), false);
    assert.equal(isDestructive("update_requirement"), false);
  });

  it("carries a prompt version like every other agent", () => {
    assert.match(PROMPT_VERSION, /^assistant@v\d+$/);
  });
});
