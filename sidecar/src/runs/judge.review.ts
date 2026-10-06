import { review } from "../decisions/index.js";
import * as store from "../store/index.js";
import { costOf, load as loadSettings } from "../store/settings.js";
import { judgeSettings, JEV_MODEL } from "./judge.js";
import { keyFor } from "./keys.js";

/**
 * Who answers the small judgement calls, and what they made of the
 * requirements.
 *
 * Rules always run first whatever the mode: there is no reason to pay
 * for a question code already answers confidently. The mode only decides
 * who gets the leftovers — except under Jev, where every question goes
 * to it, because a graded answer with honest uncertainty beats a keyword
 * list and costs a fraction of a cent.
 */

export interface Readiness {
  mode: string;
  ready: boolean;
  model: string | null;
  note: string;
}

export function readiness(projectPath: string): Readiness {
  const settings = loadSettings();
  const chosen = chosenMode(projectPath);

  if (chosen === "rules") {
    return {
      mode: "rules",
      ready: true,
      model: null,
      note: "Code answers these. Nothing is sent anywhere and nothing is charged.",
    };
  }

  if (chosen === "jev") {
    const ready = keyFor("jev") !== null;
    const model = settings.jevModel ?? JEV_MODEL;
    return {
      mode: "jev",
      ready,
      model,
      note: ready
        ? `${model} answers every question, and says how sure it is.`
        : "Add the Jev key in Settings. Until then the rules answer alone.",
    };
  }

  const model = settings.assignments["judge"] ?? null;
  return {
    mode: "model",
    ready: model !== null,
    model,
    note: model
      ? `${model} answers what the rules are unsure about.`
      : "Assign a model to judging in Settings. Until then the rules answer alone.",
  };
}

/** The mode the project asked for, not the one it falls back to. */
function chosenMode(projectPath: string): string {
  return store.readJudgeMode(projectPath);
}

/** How many questions one model-backed review may ask. */
const LIMIT = 60;

/**
 * Reads every requirement and reports what looks wrong with the set:
 * which are too vague to test, and which two say the same thing.
 */
export async function reviewRequirements(projectPath: string): Promise<Record<string, unknown>> {
  const requirements = store.requirements.list(projectPath).filter((item) => !item.orphaned);
  if (requirements.length === 0) throw new Error("there are no requirements to review yet");

  const state = readiness(projectPath);
  const judge = judgeSettings(projectPath);

  const answer = (await review({
    ...judge,
    requirements: requirements.map((item) => ({
      id: item.id,
      title: item.title,
      acceptance: item.acceptance,
    })),
    limit: LIMIT,
  })) as Record<string, unknown>;

  // A review that asked a judge anything is a run like any other: it
  // cost something, and the next person deserves to see what answered.
  const asked = Number(answer["asked"] ?? 0);
  if (asked > 0) {
    const model = String(answer["model"] ?? state.model ?? "");
    const named = state.mode === "jev" ? `jev:${model}` : model;
    const cost = costOf(
      named,
      Number(answer["inputTokens"] ?? 0),
      Number(answer["outputTokens"] ?? 0),
    );

    store.runs.save(projectPath, {
      id: store.nextRunId(projectPath),
      kind: "review",
      startedAt: store.now(),
      finishedAt: store.now(),
      status: "finished",
      model: named,
      prompt: "review/1",
      batches: 1,
      batchesDone: 1,
      attempts: 1,
      inputTokens: Number(answer["inputTokens"] ?? 0),
      outputTokens: Number(answer["outputTokens"] ?? 0),
      cost,
      produced: Array.isArray(answer["findings"]) ? answer["findings"].length : 0,
      note: answer["failure"] ? `some questions went unanswered: ${String(answer["failure"])}` : null,
      judge: state.mode,
      pieces: [],
    });
    if (cost !== null) answer["cost"] = cost;
  }

  answer["note"] = state.note;
  answer["asked_for"] = state.mode;
  return answer;
}
