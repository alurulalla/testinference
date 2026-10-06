import { writeBatch, PROMPT_VERSION } from "../agents/bdd.js";
import { foldSteps } from "../decisions/ask.js";
import { emit } from "../protocol.js";
import * as store from "../store/index.js";
import * as library from "../store/steps.js";
import { endpointFor, load as loadSettings } from "../store/settings.js";
import { judgeSettings } from "./judge.js";
import { keyFor, providerOf } from "./keys.js";
import { estimate as measure, runBatches, type Estimate } from "./manage.js";

/**
 * Writing the Gherkin, and keeping the step library tidy as it goes.
 *
 * Every step the model proposes is checked against the library before
 * any of it is called new. With a judge available a step is reused when
 * it means the same thing, not only when it is worded the same.
 */

const BATCH = 4;

/** Only approved cases; Gate B decides what gets written up. */
function approved(projectPath: string): store.TestCase[] {
  return store.cases.list(projectPath).filter((item) => item.state === "approved");
}

export function estimate(projectPath: string): Estimate {
  return measure({
    units: approved(projectPath).length,
    perBatch: BATCH,
    inPerUnit: 300,
    outPerUnit: 560,
    job: "write-bdd",
    nothing: "there are no approved cases to write up — approve some at Gate B",
  });
}

export async function run(projectPath: string): Promise<store.Run> {
  const planned = estimate(projectPath);
  if (planned.units === 0) throw new Error(planned.note);
  if (planned.overBudget) throw new Error(planned.note);
  if (!planned.model) throw new Error("assign a model to writing BDD first");

  const settings = loadSettings();
  const provider = providerOf(planned.model);
  const key = keyFor(provider);
  const endpoint = endpointFor(provider, settings);
  const judge = judgeSettings(projectPath);

  const cases = approved(projectPath);
  let steps = library.read(projectPath);
  let reused = 0;
  let added = 0;

  const batches: store.TestCase[][] = [];
  for (let at = 0; at < cases.length; at += BATCH) batches.push(cases.slice(at, at + BATCH));

  const record = await runBatches({
    projectPath,
    kind: "bdd",
    model: planned.model,
    prompt: PROMPT_VERSION,
    batches,
    work: async (batch) => {
      const answer = await writeBatch({
        model: planned.model,
        key,
        endpoint,
        library: steps,
        rows: batch.map((item) => ({
          id: item.id,
          title: item.title,
          precondition: item.precondition,
          trigger: item.steps,
          expected: item.expected,
          platform: item.platform,
        })),
      });

      for (const draft of answer.cases) {
        const source = batch.find((item) => item.id === draft.id);
        if (!source) continue;

        const folded = (await foldSteps({
          ...judge,
          proposed: draft.newSteps,
          library: steps,
        })) as { reused: unknown[]; added: string[]; library: string[] };

        reused += folded.reused.length;
        added += folded.added.length;
        steps = folded.library;

        const written: store.BddCase = {
          id: `BDD-${draft.id}`,
          caseId: draft.id,
          reqId: source.reqId,
          feature: draft.feature,
          title: draft.title,
          given: draft.given,
          when: draft.when,
          then: draft.then,
          examples: draft.examples,
          testData: draft.testData,
          platform: draft.platform,
          priority: source.priority,
          newSteps: folded.added,
          madeBy: {
            run: "pending",
            model: planned.model!,
            prompt: PROMPT_VERSION,
            attempt: answer.attempts,
          },
        };
        store.bdd.save(projectPath, written);
        emit("run:bdd", written);
      }

      library.write(projectPath, steps);
      return {
        produced: answer.cases.length,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        attempts: answer.attempts,
      };
    },
  });

  library.write(projectPath, steps);
  record.note = [record.note, `${reused} steps reused · ${added} new`].filter(Boolean).join(" · ");
  store.runs.save(projectPath, record);

  return record;
}
