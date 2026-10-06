import { enrichBatch, needsWork, PROMPT_VERSION } from "../agents/tcer.js";
import { scoreRows } from "../engines/tcer.js";
import type { TcerRow as EngineRow } from "../engines/types.js";
import * as store from "../store/index.js";
import { endpointFor, load as loadSettings } from "../store/settings.js";
import { keyFor, providerOf } from "./keys.js";
import { estimate as measure, runBatches, type Estimate } from "./manage.js";

/**
 * Turning approved scenarios into rows someone could execute, then
 * scoring them.
 *
 * The model only sees rows that are actually missing something. A
 * scenario that already says what to do, what to do it to, and what
 * should happen needs no model at all — and most of them do.
 */

const BATCH = 8;

/** Only approved scenarios become rows; Gate A is not advisory. */
function approved(projectPath: string): store.Scenario[] {
  return store.scenarios.list(projectPath).filter((scenario) => scenario.state === "approved");
}

function asRow(scenario: store.Scenario, position: number, earlier?: store.TcerRow): store.TcerRow {
  return {
    id: scenario.id,
    // An identity allocated once and never renumbered, because every
    // join in the traceability matrix depends on it staying still.
    tcId: earlier?.tcId ?? store.tcerId(position),
    reqId: scenario.reqId,
    reqVersion: scenario.reqVersion,
    title: scenario.title,
    precondition: earlier?.precondition || scenario.precondition,
    trigger: earlier?.trigger || scenario.trigger,
    expected: earlier?.expected || scenario.expected,
    priority: scenario.priority,
    score: 0,
    verdict: "",
    reasons: [],
    removed: earlier?.removed ?? false,
    comment: earlier?.comment ?? null,
    madeBy: earlier?.madeBy ?? null,
  };
}

export function estimate(projectPath: string): Estimate {
  const earlier = new Map(store.tcer.list(projectPath).map((row) => [row.id, row]));
  const incomplete = approved(projectPath)
    .map((scenario, at) => asRow(scenario, at, earlier.get(scenario.id)))
    .filter((row) => needsWork(row)).length;

  return measure({
    units: incomplete,
    perBatch: BATCH,
    inPerUnit: 180,
    outPerUnit: 260,
    job: "complete-tcer",
    nothing: "every row is already complete — nothing needs a model",
  });
}

export async function run(projectPath: string): Promise<store.Run> {
  const scenarios = approved(projectPath);
  if (scenarios.length === 0) {
    throw new Error("there are no approved scenarios to build rows from");
  }

  const planned = estimate(projectPath);
  if (planned.overBudget) throw new Error(planned.note);

  const settings = loadSettings();
  const earlier = new Map(store.tcer.list(projectPath).map((row) => [row.id, row]));
  const rows = scenarios.map((scenario, at) => asRow(scenario, at, earlier.get(scenario.id)));

  const incomplete = rows.filter((row) => needsWork(row));
  const filled = new Map<string, { precondition: string; trigger: string; expected: string }>();

  let record: store.Run;
  if (incomplete.length === 0 || !planned.model) {
    // Nothing to ask a model, so the run exists only to record the
    // scoring. Saying "no model needed" is truer than naming one.
    record = {
      id: store.nextRunId(projectPath),
      kind: "tcer",
      startedAt: store.now(),
      finishedAt: store.now(),
      status: "finished",
      model: planned.model ?? "none needed",
      prompt: PROMPT_VERSION,
      batches: 0,
      batchesDone: 0,
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: null,
      produced: 0,
      note: null,
      judge: store.readJudgeMode(projectPath),
      pieces: [],
    };
  } else {
    const provider = providerOf(planned.model);
    const key = keyFor(provider);
    const endpoint = endpointFor(provider, settings);

    const batches: store.TcerRow[][] = [];
    for (let at = 0; at < incomplete.length; at += BATCH) {
      batches.push(incomplete.slice(at, at + BATCH));
    }

    record = await runBatches({
      projectPath,
      kind: "tcer",
      model: planned.model,
      prompt: PROMPT_VERSION,
      batches,
      work: async (batch) => {
        const answer = await enrichBatch({
          model: planned.model,
          key,
          endpoint,
          rows: batch.map((row) => ({
            id: row.id,
            title: row.title,
            precondition: row.precondition,
            trigger: row.trigger,
            expected: row.expected,
          })),
        });

        for (const done of answer.rows) {
          filled.set(done.id, {
            precondition: done.precondition,
            trigger: done.trigger,
            expected: done.expected,
          });
        }

        return {
          produced: answer.rows.length,
          inputTokens: answer.inputTokens,
          outputTokens: answer.outputTokens,
          attempts: answer.attempts,
        };
      },
    });
  }

  for (const row of rows) {
    const done = filled.get(row.id);
    if (!done) continue;
    row.precondition = done.precondition || row.precondition;
    row.trigger = done.trigger || row.trigger;
    row.expected = done.expected || row.expected;
    row.madeBy = {
      run: record.id,
      model: record.model,
      prompt: PROMPT_VERSION,
      attempt: record.attempts,
    };
  }

  // The score is not the model's opinion: four presence checks, run
  // after the fact, which anyone can repeat by reading the row.
  const scored = scoreRows(rows as unknown as EngineRow[]);
  for (const row of rows) {
    const line = scored.rows.find((entry) => entry.tcId === row.tcId);
    if (!line) continue;
    row.score = line.score;
    row.verdict = line.verdict;
    row.reasons = line.reasons;
    store.tcer.save(projectPath, row);
  }

  record.produced = rows.length;
  record.note = [record.note, `${rows.length} rows · average ${scored.average}%`]
    .filter(Boolean)
    .join(" · ");
  store.runs.save(projectPath, record);

  return record;
}
