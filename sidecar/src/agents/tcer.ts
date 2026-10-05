import { complete, splitModelId, type Completion } from "../models/index.js";
import { log } from "../protocol.js";

/**
 * The completer: makes a scenario executable.
 *
 * Only rows that are actually missing something are sent to a model. A
 * scenario the designer already wrote in full is passed through untouched —
 * paying twice for the same sentence helps nobody.
 */

export const PROMPT_VERSION = "tcer@v1";

const SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "the scenario id given to you" },
          precondition: { type: "string", description: "the state before, in one or two sentences" },
          trigger: { type: "string", description: "the action taken, in one or two sentences" },
          expected: { type: "string", description: "what is observable afterwards" },
        },
        required: ["id", "precondition", "trigger", "expected"],
      },
    },
  },
  required: ["rows"],
} as const;

const SYSTEM = `You complete test scenarios so that someone could execute them.

For each scenario, write three fields:
- precondition: the state the system must be in before, including any data that must exist.
- trigger: the action or input, specific enough to repeat.
- expected: what is observable afterwards — a message, a state, a value. It must be something a person or a machine could check.

Rules:
- One or two sentences each. No prose, no restating the title.
- Never write filler such as "the system responds correctly". If you cannot say what should be observed, leave expected empty and it will be flagged.
- Keep the scenario's own meaning. You are completing it, not redesigning it.
- Answer for every scenario given, using the id you were given.`;

export interface RowIn {
  id: string;
  title: string;
  precondition: string;
  trigger: string;
  expected: string;
}

export interface EnrichResult {
  rows: Array<{ id: string; precondition: string; trigger: string; expected: string }>;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
}

/** A row is complete when all three fields say something real. */
export function needsWork(row: RowIn): boolean {
  return [row.precondition, row.trigger, row.expected].some((value) => value.trim().length === 0);
}

export async function enrichBatch(params: Record<string, unknown>): Promise<EnrichResult> {
  const model = String(params["model"] ?? "");
  const rows = (params["rows"] ?? []) as RowIn[];
  const key = typeof params["key"] === "string" ? params["key"] : null;
  const endpoint = typeof params["endpoint"] === "string" ? params["endpoint"] : null;

  if (rows.length === 0) return { rows: [], inputTokens: 0, outputTokens: 0, attempts: 0 };
  splitModelId(model);

  const user = [
    "Complete these scenarios.",
    "",
    ...rows.map((row) =>
      [
        `<<<SCENARIO ${row.id}>>>`,
        row.title,
        row.precondition ? `Before: ${row.precondition}` : "Before: (missing)",
        row.trigger ? `Do: ${row.trigger}` : "Do: (missing)",
        row.expected ? `Expect: ${row.expected}` : "Expect: (missing)",
        `<<<END ${row.id}>>>`,
      ].join("\n"),
    ),
  ].join("\n");

  const known = new Set(rows.map((row) => row.id));
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let lastProblem = "";

  while (attempts < 2) {
    attempts += 1;
    let answer: Completion;
    try {
      answer = (await complete({
        model,
        key,
        endpoint,
        request: {
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content:
                attempts === 1
                  ? user
                  : `${user}\n\nYour previous answer was unusable: ${lastProblem}. Answer again, in the shape asked for.`,
            },
          ],
          schema: SCHEMA as unknown as Record<string, unknown>,
          maxTokens: 4096,
        },
      })) as Completion;
    } catch (error: unknown) {
      if (attempts >= 2) throw error;
      lastProblem = error instanceof Error ? error.message : String(error);
      continue;
    }

    inputTokens += answer.inputTokens;
    outputTokens += answer.outputTokens;

    const data = answer.data as { rows?: unknown } | null;
    const list = data?.rows;
    if (!Array.isArray(list)) {
      lastProblem = "there was no list of rows";
      log(`completer: ${lastProblem}`);
      continue;
    }

    const out: EnrichResult["rows"] = [];
    let problem = "";
    for (const [position, entry] of list.entries()) {
      const item = entry as Record<string, unknown>;
      const id = typeof item?.["id"] === "string" ? item["id"] : "";
      if (!known.has(id)) {
        problem = `row ${position} pointed at ${id || "nothing"}, which was not in this batch`;
        break;
      }
      out.push({
        id,
        precondition: String(item["precondition"] ?? "").trim(),
        trigger: String(item["trigger"] ?? "").trim(),
        expected: String(item["expected"] ?? "").trim(),
      });
    }

    if (problem === "") return { rows: out, inputTokens, outputTokens, attempts };
    lastProblem = problem;
    log(`completer: ${problem}`);
  }

  throw new Error(`the model would not answer in the shape asked for: ${lastProblem}`);
}
