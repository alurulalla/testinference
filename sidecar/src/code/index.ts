import { intentsFor, type Intent } from "./intents.js";
import { matchTargets, type Control } from "./match.js";
import { fileFor, lineFor, specFor, type Line } from "./render.js";

/**
 * From approved test cases to a file a browser can run.
 *
 * Three steps, kept apart on purpose. A writing model reads the prose and
 * says what each step does; the map says what controls exist; a judge
 * decides which control each step means. No step in that chain is allowed
 * to invent a selector, which is the single thing that makes generated
 * tests fail on contact.
 */

/**
 * The steps as the runner will replay them.
 *
 * The same plan produces the file a person commits and the run the app
 * performs. Generating them separately would let the two drift, and a
 * test that behaves differently in the app than in CI is worse than
 * either one alone.
 */
export interface Plan {
  id: string;
  title: string;
  steps: Array<{
    from: string;
    action: string;
    selector: string | null;
    value: string;
    problem: string | null;
    first: boolean;
  }>;
  runnable: boolean;
}

export interface Written {
  file: string;
  plans: Plan[];
  specs: Array<{ id: string; title: string; unfinished: number; checks: number; lines: Line[] }>;
  runnable: number;
  unfinished: number;
  asked: number;
  inputTokens: number;
  outputTokens: number;
}

export async function generate(params: Record<string, unknown>): Promise<Written> {
  const controls = (params["controls"] ?? []) as Control[];
  const startUrl = String(params["startUrl"] ?? "");
  const judge = (params["judge"] ?? {}) as Record<string, unknown>;
  const label = String(params["runId"] ?? "");

  const planned = (await intentsFor(params)) as {
    cases: Array<{ id: string; title: string; steps: Intent[]; checks: Intent[] }>;
    inputTokens: number;
    outputTokens: number;
  };

  const specs = [];
  const plans: Plan[] = [];
  let asked = 0;
  let judged = 0;

  for (const item of planned.cases) {
    // The checks are actions too; the expected result is just the last
    // thing the test does.
    const intents: Intent[] = [
      ...(item.steps ?? []),
      ...(item.checks ?? []).map((check) => ({
        from: `expected: ${check.value || check.target}`,
        action: check.action,
        target: check.target,
        value: check.value,
      })),
    ];

    const { matched, asked: thisMany, inputTokens } = await matchTargets(intents, controls, judge);
    asked += thisMany;
    judged += inputTokens;

    const lines = intents.map((intent, at) =>
      lineFor(intent, matched[at] ?? { control: null, confidence: 0, why: "no answer", by: "rules" }, startUrl),
    );
    const spec = specFor(item, lines, startUrl);
    specs.push(spec);

    plans.push({
      id: item.id,
      title: item.title,
      runnable: spec.unfinished === 0 && spec.checks > 0,
      steps: intents.map((intent, at) => {
        const found = matched[at];
        const line = lines[at]!;
        return {
          from: intent.from,
          action: intent.action,
          // An assertion the judge was unsure of checks the whole page,
          // exactly as the written file does.
          selector:
            line.code === null
              ? null
              : intent.action === "expectText" && (!found?.control || found.confidence < 0.7)
                ? null
                : (found?.control?.selector ?? null),
          // Resolved here rather than in each consumer. The written file
          // and the runner both read this plan, and an empty address that
          // one of them fills in and the other does not is precisely the
          // drift keeping a single plan was meant to prevent.
          value: intent.action === "goto" ? intent.value || startUrl : intent.value,
          problem: line.problem,
          first: (found?.control?.matches ?? 1) > 1,
        };
      }),
    });
  }

  return {
    file: fileFor(specs, startUrl, label),
    plans,
    specs,
    runnable: specs.filter((spec) => spec.unfinished === 0 && spec.checks > 0).length,
    unfinished: specs.filter((spec) => spec.unfinished > 0 || spec.checks === 0).length,
    asked,
    inputTokens: planned.inputTokens + judged,
    outputTokens: planned.outputTokens,
  };
}
