import { designBatch, PROMPT_VERSION } from "../agents/scenarios.js";
import { label } from "../decisions/ask.js";
import { emit } from "../protocol.js";
import * as store from "../store/index.js";
import { endpointFor, load as loadSettings } from "../store/settings.js";
import { judgeSettings } from "./judge.js";
import { estimate as measure, runBatches, type Estimate } from "./manage.js";
import { keyFor, providerOf } from "./keys.js";

/**
 * Designing scenarios from requirements.
 *
 * In delta mode only requirements with no scenarios are sent, so
 * designing again after adding a document does not throw away what was
 * approved at Gate A.
 */

const BATCH = 6;

/** Which requirements this run would work on. */
function toDesign(projectPath: string, delta: boolean): store.Requirement[] {
  const all = store.requirements.list(projectPath).filter((item) => !item.orphaned);
  if (!delta) return all;

  const covered = new Set(store.scenarios.list(projectPath).map((scenario) => scenario.reqId));
  return all.filter((requirement) => !covered.has(requirement.id));
}

export function estimate(projectPath: string, delta = true): Estimate {
  return measure({
    units: toDesign(projectPath, delta).length,
    perBatch: BATCH,
    inPerUnit: 220,
    outPerUnit: 420,
    job: "design-scenarios",
    nothing: "there are no requirements left to design from",
  });
}

export async function run(projectPath: string, delta = true): Promise<store.Run> {
  const planned = estimate(projectPath, delta);
  if (planned.overBudget) throw new Error(planned.note);
  if (planned.units === 0) throw new Error(planned.note);
  if (!planned.model) throw new Error("assign a model to designing scenarios first");

  const settings = loadSettings();
  const provider = providerOf(planned.model);
  const key = keyFor(provider);
  const endpoint = endpointFor(provider, settings);

  const requirements = toDesign(projectPath, delta);
  const version = new Map(requirements.map((item) => [item.id, item.version]));

  // A full design starts again; a delta keeps what is already approved.
  if (!delta) store.scenarios.clear(projectPath);
  let position = store.nextNumber(
    store.scenarios.list(projectPath).map((scenario) => scenario.id),
    "TS-",
  );

  const batches: store.Requirement[][] = [];
  for (let at = 0; at < requirements.length; at += BATCH) {
    batches.push(requirements.slice(at, at + BATCH));
  }

  const record = await runBatches({
    projectPath,
    kind: "design",
    model: planned.model,
    prompt: PROMPT_VERSION,
    batches,
    work: async (batch) => {
      const answer = await designBatch({
        model: planned.model,
        key,
        endpoint,
        requirements: batch.map((requirement) => ({
          id: requirement.id,
          title: requirement.title,
          acceptance: requirement.acceptance,
          domain: requirement.domain,
        })),
      });

      for (const draft of answer.scenarios) {
        const scenario: store.Scenario = {
          id: store.scenarioId(position),
          reqId: draft.reqId,
          reqVersion: version.get(draft.reqId) ?? 1,
          title: draft.title,
          class: draft.class,
          priority: draft.priority,
          autoFeasibility: draft.autoFeasibility,
          precondition: draft.precondition,
          trigger: draft.trigger,
          expected: draft.expected,
          state: "pending",
          decidedAt: null,
          comment: null,
          madeBy: {
            run: "pending",
            model: planned.model!,
            prompt: PROMPT_VERSION,
            attempt: answer.attempts,
          },
        };
        position += 1;
        store.scenarios.save(projectPath, scenario);
        emit("run:scenario", scenario);
      }

      return {
        produced: answer.scenarios.length,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        attempts: answer.attempts,
        skipped: answer.skipped.map((entry) => `${entry.reqId}: ${entry.why}`),
      };
    },
  });

  // A second opinion on the labels, from something trained to classify
  // rather than to compose. Only what the judge is sure of is applied.
  const relabelled = await relabel(projectPath);
  if (relabelled > 0) {
    record.note = [record.note, `${relabelled} scenarios were relabelled by the judge`]
      .filter(Boolean)
      .join(" · ");
    store.runs.save(projectPath, record);
  }

  return record;
}

/** Below this, the judge is not sure enough to overrule the writer. */
const SURE_ENOUGH = 0.6;

async function relabel(projectPath: string): Promise<number> {
  const judge = judgeSettings(projectPath);
  if (judge["mode"] !== "jev") return 0;

  const scenarios = store.scenarios.list(projectPath);
  if (scenarios.length === 0) return 0;

  let answered;
  try {
    answered = await label({
      ...judge,
      scenarios: scenarios.map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        expected: scenario.expected,
      })),
    });
  } catch {
    // Labelling is a second opinion, not the pipeline. If it fails the
    // writing model's labels stand and the run is still a success.
    return 0;
  }

  let changed = 0;
  for (const entry of answered.answers) {
    const scenario = store.scenarios.get(projectPath, entry.id);
    if (!scenario) continue;

    let touched = false;
    // Each label stands on its own confidence. A shaky class does not
    // hold back a certain feasibility; they were separate questions.
    const picked = entry.answer;
    if (picked.class && picked.class.confidence >= SURE_ENOUGH && picked.class.value !== scenario.class) {
      scenario.class = picked.class.value;
      touched = true;
    }
    if (
      picked.feasibility &&
      picked.feasibility.confidence >= SURE_ENOUGH &&
      picked.feasibility.value !== scenario.autoFeasibility
    ) {
      scenario.autoFeasibility = picked.feasibility.value;
      touched = true;
    }

    if (touched) {
      scenario.madeBy = { ...scenario.madeBy, model: `${scenario.madeBy.model} · labels judged` };
      store.scenarios.save(projectPath, scenario);
      changed += 1;
    }
  }
  return changed;
}
