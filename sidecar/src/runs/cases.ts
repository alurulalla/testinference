import { writeBatch, PROMPT_VERSION } from "../agents/cases.js";
import { emit } from "../protocol.js";
import * as store from "../store/index.js";
import { endpointFor, load as loadSettings } from "../store/settings.js";
import { keyFor, providerOf } from "./keys.js";
import { estimate as measure, runBatches, type Estimate } from "./manage.js";

/**
 * Writing the test cases.
 *
 * Only from rows worth writing from. A row that was rejected at scoring,
 * or taken out of scope, is skipped and listed with its reason — the old
 * app wrote a case from every active row including the rejected ones,
 * which is how a suite fills up with tests nobody believes.
 */

const BATCH = 5;

interface Eligible {
  rows: store.TcerRow[];
  skippedRejected: number;
  skippedRemoved: number;
}

function eligible(projectPath: string): Eligible {
  const all = store.tcer.list(projectPath);
  return {
    rows: all.filter((row) => !row.removed && row.verdict !== "Reject"),
    skippedRejected: all.filter((row) => !row.removed && row.verdict === "Reject").length,
    skippedRemoved: all.filter((row) => row.removed).length,
  };
}

export function estimate(projectPath: string): Estimate & Omit<Eligible, "rows"> {
  const { rows, skippedRejected, skippedRemoved } = eligible(projectPath);
  return {
    ...measure({
      units: rows.length,
      perBatch: BATCH,
      inPerUnit: 240,
      outPerUnit: 520,
      job: "write-cases",
      nothing: "there are no rows to write cases from — score some first",
    }),
    skippedRejected,
    skippedRemoved,
  };
}

export async function run(projectPath: string): Promise<store.Run> {
  const planned = estimate(projectPath);
  if (planned.units === 0) throw new Error(planned.note);
  if (planned.overBudget) throw new Error(planned.note);
  if (!planned.model) throw new Error("assign a model to writing test cases first");

  const settings = loadSettings();
  const provider = providerOf(planned.model);
  const key = keyFor(provider);
  const endpoint = endpointFor(provider, settings);

  const { rows } = eligible(projectPath);
  const scenarios = new Map(
    store.scenarios.list(projectPath).map((scenario) => [scenario.id, scenario]),
  );
  // A re-write does not un-approve what a person already decided, and
  // does not unpublish what was published.
  const before = new Map(store.cases.list(projectPath).map((item) => [item.id, item]));

  const batches: store.TcerRow[][] = [];
  for (let at = 0; at < rows.length; at += BATCH) batches.push(rows.slice(at, at + BATCH));

  const record = await runBatches({
    projectPath,
    kind: "cases",
    model: planned.model,
    prompt: PROMPT_VERSION,
    batches,
    work: async (batch) => {
      const answer = await writeBatch({
        model: planned.model,
        key,
        endpoint,
        rows: batch.map((row) => ({
          id: row.tcId,
          title: row.title,
          precondition: row.precondition,
          trigger: row.trigger,
          expected: row.expected,
          priority: row.priority,
        })),
      });

      for (const draft of answer.cases) {
        const row = batch.find((entry) => entry.tcId === draft.id);
        if (!row) continue;
        const scenario = scenarios.get(row.id);
        const earlier = before.get(draft.id);

        const written: store.TestCase = {
          id: draft.id,
          scenarioId: row.id,
          reqId: row.reqId,
          reqVersion: row.reqVersion,
          title: draft.title,
          description: draft.description,
          caseType: draft.type,
          priority: row.priority,
          precondition: draft.precondition,
          testData: draft.testData,
          steps: draft.steps,
          expected: draft.expected,
          platform: draft.platform,
          // Carried from the scenario. Without it nothing can ever be
          // classed automatable at the feasibility stage.
          autoFeasibility: scenario?.autoFeasibility ?? "",
          state: earlier?.state ?? "pending",
          decidedAt: earlier?.decidedAt ?? null,
          comment: earlier?.comment ?? null,
          madeBy: {
            run: "pending",
            model: planned.model!,
            prompt: PROMPT_VERSION,
            attempt: answer.attempts,
          },
          importedFrom: "",
          publishId: earlier?.publishId ?? null,
          publishTarget: earlier?.publishTarget ?? null,
          publishedAt: earlier?.publishedAt ?? null,
        };
        store.cases.save(projectPath, written);
        emit("run:case", written);
      }

      return {
        produced: answer.cases.length,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        attempts: answer.attempts,
      };
    },
  });

  if (planned.skippedRejected > 0 || planned.skippedRemoved > 0) {
    record.note = [
      record.note,
      `${planned.skippedRejected} rejected and ${planned.skippedRemoved} removed rows were skipped`,
    ]
      .filter(Boolean)
      .join(" · ");
    store.runs.save(projectPath, record);
  }

  return record;
}
