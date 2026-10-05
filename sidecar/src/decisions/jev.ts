import { log } from "../protocol.js";

/**
 * Jev, TypeSafe's System One model.
 *
 * It is not a chat model and does not belong beside the three completion
 * adapters. It takes one `state` — the material to judge — and a map of
 * typed questions about it, and answers every question against that state in
 * parallel. There is no prose, no schema to coax, nothing to repair.
 *
 * Three question types exist; this app uses two. A `noul` is the graded
 * yes/no: a single probability that the answer is yes, with no separate
 * confidence, because the number is the confidence — 0.95 a confident yes,
 * 0.05 a confident no, 0.5 the model saying it does not know. A `choice`
 * picks one of a named set and returns the whole distribution, which is
 * what a controlled vocabulary wants: one question for seven classes rather
 * than seven yes/no questions.
 *
 * Protocol: POST /v1/systemone, bearer key. Documented at docs.typesafe.ai,
 * read 2026-10-05.
 */

const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1";
export const DEFAULT_MODEL = "jev-latest";

/** Jev is quick; a slow answer means something is wrong rather than busy. */
const TIMEOUT_MS = 30_000;
/** 429 and 529 are expected under load and are retried, not surfaced. */
const RETRIES = 3;

export type State = string | Record<string, unknown> | unknown[];

export interface Noul {
  type: "noul";
  instructions: string | Record<string, unknown>;
  /** What a yes and a no mean. This is where domain rules go. */
  criteria?: { true: string; false: string };
}

/** Picks one of a named set. The criteria are the rubric for each option. */
export interface Choice {
  type: "choice";
  instructions: string | Record<string, unknown>;
  criteria: Record<string, string>;
}

export type Question = Noul | Choice;

export interface Chosen {
  option: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Answered {
  /** The versioned model that answered, e.g. "jev-1.13.0". */
  model: string;
  /** Question key to the probability that its answer is yes. */
  nouls: Map<string, number>;
  /** Question key to the option picked, for the choice questions. */
  choices: Map<string, Chosen>;
  usage: Usage;
}

/**
 * Jev reports a noul as a probability and no confidence. On the same 0-to-1
 * scale as its Choice and Score confidence, certainty is the distance from
 * "I don't know".
 */
export function confidenceOf(noul: number): number {
  return Math.abs(2 * noul - 1);
}

/** Above a half is a yes. The confidence says how much to trust it. */
export function isYes(noul: number): boolean {
  return noul >= 0.5;
}

export interface Credentials {
  key: string;
  /** Only for a proxy or a private deployment. */
  endpoint?: string | null;
  model?: string | null;
}

export async function ask(
  credentials: Credentials,
  state: State,
  questions: Record<string, Question>,
): Promise<Answered> {
  const base = (credentials.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
  const model = credentials.model || DEFAULT_MODEL;

  const response = await send(
    `${base}/systemone`,
    credentials.key,
    JSON.stringify({ state, model, questions }),
  );

  const body = (await response.json()) as {
    model?: string;
    answers?: Record<
      string,
      {
        type?: string;
        noul?: number;
        choice?: string;
        confidence?: number;
        probabilities?: Record<string, number>;
      }
    >;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const nouls = new Map<string, number>();
  const choices = new Map<string, Chosen>();
  for (const [id, answer] of Object.entries(body.answers ?? {})) {
    if (typeof answer?.noul === "number") nouls.set(id, answer.noul);
    else if (typeof answer?.choice === "string") {
      choices.set(id, {
        option: answer.choice,
        confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
        probabilities: answer.probabilities ?? {},
      });
    }
  }
  if (nouls.size === 0 && choices.size === 0) {
    throw new Error("Jev answered without any answers in it");
  }

  return {
    model: body.model ?? model,
    nouls,
    choices,
    usage: {
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    },
  };
}

/** The names the account may send in the model field. Also proves the key. */
export async function models(credentials: Credentials): Promise<string[]> {
  const base = (credentials.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
  const response = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${credentials.key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TypeSafe answered ${response.status}`);

  const body = (await response.json()) as { models?: Array<{ id?: string; name?: string }> };
  return (body.models ?? [])
    .map((entry) => entry.id ?? entry.name ?? "")
    .filter((name) => name.length > 0);
}

/**
 * Posts once, then backs off and retries while the answer is "busy".
 *
 * 429 and 529 mean come back later and say nothing about the request, so
 * retrying is right; 401 and 422 are about the request itself, so retrying
 * would only repeat the mistake.
 */
async function send(url: string, key: string, body: string): Promise<Response> {
  let wait = 500;

  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.ok) return response;

    const busy = response.status === 429 || response.status === 529;
    if (!busy || attempt > RETRIES) throw await explain(response);

    // The server knows better than we do when to come back.
    const after = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(after) && after > 0 ? after * 1000 : wait;
    log(`jev answered ${response.status}; waiting ${delay} ms`);
    await new Promise((resume) => setTimeout(resume, delay));
    wait *= 2;
  }
}

async function explain(response: Response): Promise<Error> {
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  switch (response.status) {
    case 401:
      return new Error("Jev rejected the key (401). Check it in Settings.");
    case 422:
      return new Error(`Jev refused the request (422): ${detail}`);
    default:
      return new Error(`Jev answered ${response.status}: ${detail}`);
  }
}
