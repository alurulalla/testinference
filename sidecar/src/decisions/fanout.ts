import { ask, confidenceOf, type Chosen, type Credentials, type Noul, type Question } from "./jev.js";

/**
 * Asking Jev a lot of small questions.
 *
 * Jev takes one state and a map of questions about it, answered in parallel.
 * Our questions are each about a different thing, so the state has to carry
 * everything its request's questions refer to, and the questions refer to it
 * by name. This packs them into requests, runs a few at a time, and hands
 * back one answer per question in the order they were given.
 */

/** One question, with the state it needs under the names it refers to. */
export interface Unit {
  state: Record<string, unknown>;
  question: Question;
}

export interface Answer {
  /** For a yes/no question: the probability the answer is yes. */
  noul?: number;
  /** For a choice question: the option picked. */
  option?: string;
  /** Jev's own for a choice; for a noul, the distance from "I don't know". */
  confidence: number;
}

export interface FanOut {
  /** One entry per unit, in the order given; absent where a request failed. */
  answers: Map<number, Answer>;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** One message per failed request. The rest of the answers still stand. */
  failures: string[];
}

/**
 * How many questions ride in one request. Jev's budget is 32k for the state
 * plus the longest question, which twenty short ones sit far inside. The
 * real reason for a limit is blast radius: one failed request should not
 * take a whole review with it.
 *
 * Twenty is measured, not assumed. Packing fewer questions per request was
 * expected to help accuracy and does the opposite: on the document drift
 * check, twenty at a time found all four planted edits with one false
 * alarm in thirty-six, while one question per request found the same four
 * with six false alarms, twice the tokens and fifteen times the wait.
 * Seeing the neighbouring material appears to calibrate the answer.
 */
export const PER_REQUEST = 20;

export async function fanOut(
  credentials: Credentials,
  units: Unit[],
  atOnce = 4,
): Promise<FanOut> {
  const result: FanOut = {
    answers: new Map(),
    model: "",
    inputTokens: 0,
    outputTokens: 0,
    failures: [],
  };
  if (units.length === 0) return result;

  const chunks: Array<{ at: number; units: Unit[] }> = [];
  for (let at = 0; at < units.length; at += PER_REQUEST) {
    chunks.push({ at, units: units.slice(at, at + PER_REQUEST) });
  }

  // Checked before anything is sent, and thrown rather than collected as
  // a failure: this is a mistake in how the questions were built, not a
  // request that went wrong, and it must not look like one.
  for (const chunk of chunks) {
    const seen = new Map<string, string>();
    for (const unit of chunk.units) {
      for (const [name, value] of Object.entries(unit.state)) {
        // Several questions about one thing legitimately share its state
        // — what class is this scenario, and how automatable. Two
        // questions about *different* things under one name is a bug,
        // and an invisible one: the second unit's data silently answers
        // the first unit's question, and every answer looks plausible
        // while being about something else entirely.
        const written = JSON.stringify(value);
        const already = seen.get(name);
        if (already !== undefined && already !== written) {
          throw new Error(
            `two questions in one request both name their state "${name}" but mean different things; give each unit its own names`,
          );
        }
        seen.set(name, written);
      }
    }
  }

  const waves = Math.max(1, atOnce);
  for (let at = 0; at < chunks.length; at += waves) {
    const wave = chunks.slice(at, at + waves).map(async (chunk) => {
      const state: Record<string, unknown> = {};
      const questions: Record<string, Question> = {};
      chunk.units.forEach((unit, index) => {
        Object.assign(state, unit.state);
        questions[`q${index + 1}`] = unit.question;
      });
      return { chunk, answered: await ask(credentials, state, questions) };
    });

    for (const settled of await Promise.allSettled(wave)) {
      if (settled.status === "rejected") {
        result.failures.push(
          settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
        );
        continue;
      }
      const { chunk, answered } = settled.value;
      result.model = answered.model;
      result.inputTokens += answered.usage.inputTokens;
      result.outputTokens += answered.usage.outputTokens;

      chunk.units.forEach((_unit, index) => {
        const noul = answered.nouls.get(`q${index + 1}`);
        if (noul !== undefined) {
          result.answers.set(chunk.at + index, { noul, confidence: confidenceOf(noul) });
          return;
        }
        const chosen: Chosen | undefined = answered.choices.get(`q${index + 1}`);
        if (chosen) {
          result.answers.set(chunk.at + index, {
            option: chosen.option,
            confidence: chosen.confidence,
          });
        }
      });
    }
  }

  return result;
}

/** Jev refers to state by name, so the name has to be a plain one. */
export function field(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, "_");
}

export type { Credentials, Noul, Question };
