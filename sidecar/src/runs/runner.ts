import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { play } from "../run/play.js";
import { localDir } from "../store/app.js";
import * as store from "../store/index.js";
import { readContext } from "../store/project.js";

/**
 * Running the tests and keeping what happened.
 *
 * Two things are kept apart on purpose. The result — which step failed,
 * what the message was, how long it took — is small text and lives with
 * the project, so a history exists and travels to git. The screenshot is
 * large and binary and goes beside the application's own data, because
 * nobody wants a megabyte of PNG in a commit.
 */
export async function run(
  projectPath: string,
  only: string | null,
  watch: boolean,
): Promise<store.Attempt> {
  const context = readContext(projectPath);
  if (!context.appUrl.trim()) throw new Error("set the application URL on the project first");

  const plans = store.plans
    .list(projectPath)
    .filter((plan) => only === null || plan.id === only);
  if (plans.length === 0) throw new Error("there is nothing to run — write the tests first");

  const began = Date.now();
  const played = (await play({ plans, startUrl: context.appUrl, watch })) as {
    results: Array<store.CaseResult & { shot: string | null }>;
  };

  const id = `try-${String(store.attempts.count(projectPath) + 1).padStart(3, "0")}`;
  const shots = localDir(context.id, join("shots", id));

  const cases: store.CaseResult[] = played.results.map((result) => {
    // The picture comes back as text and is written out as a file, so
    // the result that goes to git stays small.
    let shot: string | null = null;
    if (result.shot) {
      try {
        const target = join(shots, `${result.id}.png`);
        writeFileSync(target, Buffer.from(result.shot, "base64"));
        shot = target;
      } catch {
        shot = null;
      }
    }
    return { ...result, shot };
  });

  const attempt: store.Attempt = {
    id,
    at: store.now(),
    passed: cases.filter((entry) => entry.state === "passed").length,
    failed: cases.filter((entry) => entry.state === "failed").length,
    unfinished: cases.filter((entry) => entry.state === "unfinished").length,
    ms: Date.now() - began,
    cases,
  };
  store.attempts.save(projectPath, attempt);

  store.runs.save(projectPath, {
    id: store.nextRunId(projectPath),
    kind: "test-run",
    startedAt: store.now(),
    finishedAt: store.now(),
    status: attempt.failed > 0 ? "failed" : "finished",
    model: "browser",
    prompt: "play/1",
    batches: 1,
    batchesDone: 1,
    attempts: 1,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    produced: attempt.passed,
    note: `${attempt.passed} passed · ${attempt.failed} failed · ${attempt.unfinished} unfinished`,
    judge: store.readJudgeMode(projectPath),
    pieces: [],
  });

  return attempt;
}

export function history(projectPath: string): store.Attempt[] {
  return store.attempts.list(projectPath);
}
