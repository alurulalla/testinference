import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { adapterFor, splitModelId } from "./index.js";

describe("the model socket", () => {
  it("splits a model id into its provider and its model", () => {
    assert.deepEqual(splitModelId("anthropic:claude-sonnet-5"), {
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    // Model names contain colons on some providers; only the first one counts.
    assert.deepEqual(splitModelId("local:qwen2.5-coder:32b"), {
      provider: "local",
      model: "qwen2.5-coder:32b",
    });
  });

  it("complains clearly when a model id has no provider", () => {
    assert.throws(() => splitModelId("claude-sonnet-5"), /provider:model/);
  });

  it("knows a plug for every provider, and local uses the OpenAI shape", () => {
    for (const provider of ["anthropic", "openai", "gemini", "local"] as const) {
      assert.ok(adapterFor(provider), `${provider} should have an adapter`);
    }
    assert.equal(adapterFor("local"), adapterFor("openai"));
  });

  it("refuses an unknown provider rather than guessing", () => {
    // @ts-expect-error — deliberately wrong, to prove it is caught
    assert.throws(() => adapterFor("acme"), /no adapter/);
  });
});
