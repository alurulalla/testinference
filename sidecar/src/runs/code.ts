import { join } from "node:path";

import { generate } from "../code/index.js";
import { atomicWrite } from "../store/paths.js";
import * as store from "../store/index.js";
import { readContext } from "../store/project.js";
import { endpointFor, load as loadSettings } from "../store/settings.js";
import { judgeSettings } from "./judge.js";
import { keyFor, providerOf } from "./keys.js";

/**
 * Turning approved test cases into a file a browser can run.
 *
 * The map earns its keep here. Every other tool that writes test code
 * asks a model to invent a selector from prose, which produces code that
 * reads perfectly and matches nothing. This asks a narrower question —
 * here are the controls observed to exist, which one does this step mean
 * — and refuses to write a line when the answer is none.
 */

export interface CodeEstimate {
  cases: number;
  pages: number;
  controls: number;
  model: string | null;
  note: string;
}

/** Approved, and not something only a person can do. */
function eligible(projectPath: string): store.TestCase[] {
  return store.cases
    .list(projectPath)
    .filter((item) => item.state === "approved")
    .filter((item) => item.autoFeasibility.toLowerCase() !== "manual");
}

export function estimate(projectPath: string): CodeEstimate {
  const cases = eligible(projectPath);
  const pages = store.appPages.list(projectPath);
  const controls = pages.reduce(
    (total, page) => total + page.elements.filter((element) => element.kind !== "text").length,
    0,
  );
  const model = loadSettings().assignments["write-cases"] ?? null;

  const note =
    pages.length === 0
      ? "Explore the application first. Without a map, every selector would be a guess."
      : cases.length === 0
        ? "No approved test cases that a tool could run. Approve some at Gate B, or check they are not all marked manual."
        : model === null
          ? "Assign a model to writing test cases in Settings — reading the steps needs one."
          : `${cases.length} cases against ${controls} controls on ${pages.length} pages.`;

  return { cases: cases.length, pages: pages.length, controls, model, note };
}

export interface Generated {
  path: string;
  runnable: number;
  unfinished: number;
  gaps: unknown[];
  run: store.Run;
  note: string;
}

export async function run(projectPath: string): Promise<Generated> {
  const planned = estimate(projectPath);
  if (planned.pages === 0 || planned.cases === 0 || !planned.model) throw new Error(planned.note);

  const settings = loadSettings();
  const context = readContext(projectPath);
  const provider = providerOf(planned.model);

  // Text is included here, unlike in the counts: a heading is not
  // something to click, but it is exactly what a check reads.
  const controls = store.appPages.list(projectPath).flatMap((page) =>
    page.elements.map((element) => ({
      page: page.url,
      role: element.role,
      name: element.name,
      selector: element.selector,
      kind: element.kind,
      matches: element.matches,
      sturdiness: element.sturdiness,
    })),
  );

  const runId = store.nextRunId(projectPath);
  const written = (await generate({
    model: planned.model,
    key: keyFor(provider),
    endpoint: endpointFor(provider, settings),
    cases: eligible(projectPath).map((item) => ({
      id: item.id,
      title: item.title,
      precondition: item.precondition,
      testData: item.testData,
      steps: item.steps,
      expected: item.expected,
    })),
    controls,
    startUrl: context.appUrl,
    runId,
    judge: judgeSettings(projectPath),
  })) as {
    file: string;
    plans: store.Plan[];
    specs: Array<{ id: string; unfinished: number; checks: number }>;
    runnable: number;
    unfinished: number;
    inputTokens: number;
    outputTokens: number;
  };

  // The plan is saved beside the file, because the in-app runner
  // replays it. Generated separately they would drift, and a test that
  // behaves differently here than in CI is worse than either alone.
  store.plans.clear(projectPath);
  for (const plan of written.plans) store.plans.save(projectPath, plan);

  // Beside the project, not inside its context folder: this is source
  // code, and it belongs where a developer would look for it.
  const target = join(projectPath, "tests", "generated.spec.ts");
  atomicWrite(target, written.file);

  const record: store.Run = {
    id: runId,
    kind: "code",
    startedAt: store.now(),
    finishedAt: store.now(),
    status: "finished",
    model: planned.model,
    prompt: "intents@v1",
    batches: 1,
    batchesDone: 1,
    attempts: 1,
    inputTokens: written.inputTokens,
    outputTokens: written.outputTokens,
    cost: null,
    produced: written.runnable,
    note: `${written.runnable} runnable · ${written.unfinished} unfinished`,
    judge: store.readJudgeMode(projectPath),
    pieces: [],
  };
  store.runs.save(projectPath, record);

  return {
    path: target,
    runnable: written.runnable,
    unfinished: written.unfinished,
    gaps: written.specs.filter((spec) => spec.unfinished > 0 || spec.checks === 0),
    run: record,
    note: `${written.runnable} tests can run. ${written.unfinished} are marked unfinished — they are in the file, but marked so they report as not done rather than quietly passing.`,
  };
}
