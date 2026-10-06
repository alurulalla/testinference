import { emit } from "../protocol.js";
import * as store from "../store/index.js";
import { costOf, load as loadSettings, type Settings } from "../store/settings.js";
import { clear, stopRequested } from "./cancel.js";

/**
 * What every stage of the pipeline does with a model.
 *
 * Estimate the work, check it against the budget before spending
 * anything, then run it in batches — saving as it goes, reporting
 * progress, and stopping if asked or if the cost runs away.
 *
 * There was one of these for each stage, five times over. They differ in
 * what they send and what they save; everything else was copied. This is
 * the everything else.
 */

export interface Estimate {
  units: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  cost: number | null;
  overBudget: boolean;
  note: string;
}

export interface Measure {
  /** How many things there are to do. */
  units: number;
  perBatch: number;
  /** Rough tokens each unit costs to send and to get back. */
  inPerUnit: number;
  outPerUnit: number;
  /** The job name in Settings, which decides the model. */
  job: string;
  /** What to say when there is nothing to do. */
  nothing: string;
}

export function estimate(measure: Measure, settings: Settings = loadSettings()): Estimate {
  const model = settings.assignments[measure.job] ?? null;
  const batches = Math.ceil(measure.units / measure.perBatch);
  const inputTokens = measure.units * measure.inPerUnit;
  const outputTokens = measure.units * measure.outPerUnit;
  const cost = model ? costOf(model, inputTokens, outputTokens, settings) : null;
  const overBudget = cost !== null && cost > settings.budgets.perRun;

  const note =
    measure.units === 0
      ? measure.nothing
      : model === null
        ? `no model is assigned to ${measure.job} yet`
        : cost === null
          ? "cost unknown — set this model's price to have the budget enforced"
          : overBudget
            ? `about $${cost.toFixed(2)}, which is over the $${settings.budgets.perRun.toFixed(2)} limit for one run`
            : `about $${cost.toFixed(2)} on your own key`;

  return { units: measure.units, batches, inputTokens, outputTokens, model, cost, overBudget, note };
}

export interface BatchOutcome {
  /** How many records this batch produced. */
  produced: number;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  /** Things the model declined to do, reported rather than hidden. */
  skipped?: string[];
}

export interface RunPlan<T> {
  projectPath: string;
  /** extract · design · tcer · cases · bdd */
  kind: string;
  model: string;
  prompt: string;
  batches: T[][];
  /** Fingerprints of what was read, for the next delta run. */
  pieces?: string[];
  /** Does one batch. Throwing is a failed batch, not a failed run. */
  work: (batch: T[], index: number) => Promise<BatchOutcome>;
}

/** A batch that fails is tried once more; a model has a bad minute. */
const RETRY_AFTER_MS = 2_000;

export async function runBatches<T>(plan: RunPlan<T>): Promise<store.Run> {
  const settings = loadSettings();
  clear(plan.kind);

  const record: store.Run = {
    id: store.nextRunId(plan.projectPath),
    kind: plan.kind,
    startedAt: store.now(),
    finishedAt: null,
    status: "running",
    model: plan.model,
    prompt: plan.prompt,
    batches: plan.batches.length,
    batchesDone: 0,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    produced: 0,
    note: null,
    judge: store.readJudgeMode(plan.projectPath),
    pieces: plan.pieces ?? [],
  };
  store.runs.save(plan.projectPath, record);

  const failed: number[] = [];
  const skipped: string[] = [];

  for (const [index, batch] of plan.batches.entries()) {
    if (stopRequested(plan.kind)) {
      record.status = "stopped";
      record.note = `stopped after ${index} of ${plan.batches.length} batches`;
      break;
    }

    let outcome: BatchOutcome | null = null;
    for (let attempt = 1; attempt <= 2 && outcome === null; attempt += 1) {
      try {
        outcome = await plan.work(batch, index);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (attempt === 2) {
          failed.push(index + 1);
          emit("run:problem", { batch: index + 1, detail });
        } else {
          await new Promise((wait) => setTimeout(wait, RETRY_AFTER_MS));
        }
      }
    }

    if (outcome) {
      record.produced += outcome.produced;
      record.inputTokens += outcome.inputTokens;
      record.outputTokens += outcome.outputTokens;
      record.attempts += outcome.attempts;
      if (outcome.skipped) skipped.push(...outcome.skipped);
    }

    record.batchesDone = index + 1;
    record.cost = costOf(plan.model, record.inputTokens, record.outputTokens, settings);

    // Checked after each batch, so a run that turns out expensive stops
    // partway rather than at the end when the money is already spent.
    if (record.cost !== null && record.cost > settings.budgets.perRun) {
      record.status = "stopped";
      record.note = `stopped at the $${settings.budgets.perRun.toFixed(2)} limit for one run`;
      store.runs.save(plan.projectPath, record);
      break;
    }

    store.runs.save(plan.projectPath, record);
    emit("run:progress", {
      runId: record.id,
      done: record.batchesDone,
      total: record.batches,
      found: record.produced,
      cost: record.cost,
    });
  }

  if (record.status === "running") record.status = "finished";

  const notes: string[] = [];
  if (record.note) notes.push(record.note);
  if (failed.length > 0) notes.push(`${failed.length} batches failed: ${failed.join(", ")}`);
  if (skipped.length > 0) notes.push(`${skipped.length} skipped`);
  record.note = notes.length > 0 ? notes.join(" · ") : null;

  record.finishedAt = store.now();
  store.runs.save(plan.projectPath, record);
  emit("run:finished", record);
  clear(plan.kind);

  return record;
}
