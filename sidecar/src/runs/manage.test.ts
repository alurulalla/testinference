import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

let area: string;
let manage: typeof import("./manage.js");
let cancel: typeof import("./cancel.js");
let settings: typeof import("../store/settings.js");
let store: typeof import("../store/index.js");

before(async () => {
  area = mkdtempSync(join(tmpdir(), "ti-runs-"));
  process.env["TESTINFERENCE_DATA_DIR"] = area;
  [manage, cancel, settings, store] = await Promise.all([
    import("./manage.js"),
    import("./cancel.js"),
    import("../store/settings.js"),
    import("../store/index.js"),
  ]);
  settings.update({
    assignments: { "design-scenarios": "anthropic:test" },
    prices: { "anthropic:test": { inputPerMillion: 3, outputPerMillion: 15 } },
    budgets: { perRun: 1, monthly: 100, maxParallel: 4 },
  });
});

after(() => {
  delete process.env["TESTINFERENCE_DATA_DIR"];
  rmSync(area, { recursive: true, force: true });
});

const project = () => mkdtempSync(join(tmpdir(), "ti-proj-"));

describe("working out what a run will cost before spending anything", () => {
  it("says so when nothing is assigned", () => {
    const planned = manage.estimate({
      units: 10, perBatch: 5, inPerUnit: 100, outPerUnit: 100,
      job: "write-bdd", nothing: "nothing to do",
    });
    assert.equal(planned.model, null);
    assert.match(planned.note, /no model is assigned/);
  });

  it("refuses a run that would cost more than the limit", () => {
    const planned = manage.estimate({
      units: 100_000, perBatch: 10, inPerUnit: 100, outPerUnit: 100,
      job: "design-scenarios", nothing: "nothing to do",
    });
    assert.equal(planned.overBudget, true);
    assert.match(planned.note, /over the \$1.00 limit/);
  });

  it("says the cost is unknown rather than free when there is no price", () => {
    settings.update({ assignments: { "write-bdd": "anthropic:unpriced" } });
    const planned = manage.estimate({
      units: 10, perBatch: 5, inPerUnit: 100, outPerUnit: 100,
      job: "write-bdd", nothing: "nothing to do",
    });
    // Treating an unpriced model as free is how a budget silently fails.
    assert.equal(planned.cost, null);
    assert.equal(planned.overBudget, false);
    assert.match(planned.note, /cost unknown/);
  });
});

describe("running the batches", () => {
  it("records what it produced and finishes", async () => {
    const dir = project();
    const record = await manage.runBatches({
      projectPath: dir, kind: "design", model: "anthropic:test", prompt: "p@v1",
      batches: [[1], [2], [3]],
      work: async () => ({ produced: 2, inputTokens: 10, outputTokens: 5, attempts: 1 }),
    });

    assert.equal(record.status, "finished");
    assert.equal(record.batchesDone, 3);
    assert.equal(record.produced, 6);
    assert.equal(store.runs.list(dir).length, 1, "the run is in the project");
    rmSync(dir, { recursive: true, force: true });
  });

  it("tries a failed batch once more before giving up on it", async () => {
    const dir = project();
    let tries = 0;
    const record = await manage.runBatches({
      projectPath: dir, kind: "design", model: "anthropic:test", prompt: "p@v1",
      batches: [[1]],
      work: async () => {
        tries += 1;
        if (tries === 1) throw new Error("a bad minute");
        return { produced: 1, inputTokens: 1, outputTokens: 1, attempts: 1 };
      },
    });

    assert.equal(tries, 2);
    assert.equal(record.produced, 1, "the retry's work counts");
    assert.equal(record.note, null, "and it is not reported as a failure");
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the batches that worked when one fails for good", async () => {
    const dir = project();
    const record = await manage.runBatches({
      projectPath: dir, kind: "design", model: "anthropic:test", prompt: "p@v1",
      batches: [[1], [2]],
      work: async (batch) => {
        if (batch[0] === 2) throw new Error("no");
        return { produced: 3, inputTokens: 1, outputTokens: 1, attempts: 1 };
      },
    });

    assert.equal(record.produced, 3, "a failed batch does not lose the others");
    assert.match(record.note ?? "", /1 batches failed: 2/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("stops when asked, and says where it got to", async () => {
    const dir = project();
    const record = await manage.runBatches({
      projectPath: dir, kind: "design", model: "anthropic:test", prompt: "p@v1",
      batches: [[1], [2], [3]],
      work: async () => {
        cancel.askToStop("design");
        return { produced: 1, inputTokens: 1, outputTokens: 1, attempts: 1 };
      },
    });

    assert.equal(record.status, "stopped");
    assert.match(record.note ?? "", /stopped after 1 of 3/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("stops partway when the cost runs away, not at the end", async () => {
    const dir = project();
    const record = await manage.runBatches({
      projectPath: dir, kind: "design", model: "anthropic:test", prompt: "p@v1",
      batches: [[1], [2], [3], [4]],
      // Each batch costs about $0.60 at the test price, so the $1 limit
      // is passed on the second.
      work: async () => ({ produced: 1, inputTokens: 200_000, outputTokens: 0, attempts: 1 }),
    });

    assert.equal(record.status, "stopped");
    assert.equal(record.batchesDone, 2, "it stopped rather than spending the lot");
    assert.match(record.note ?? "", /limit for one run/);
    rmSync(dir, { recursive: true, force: true });
  });
});
