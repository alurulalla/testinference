import { useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { call, describeError, on } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import { useDetail } from "../ui/detail";
import RequirementDetail from "./RequirementDetail";
import type {
  Delta,
  OpenProject,
  Requirement,
  Review,
  Run,
  Scenario,
  TestCase,
} from "../types/api";

type Phase = "idle" | "estimating" | "ready" | "running";

export default function RequirementsPanel({ project }: { project: OpenProject }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<Delta | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [checking, setChecking] = useState(false);
  const [showUnsure, setShowUnsure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(false);

  useEffect(() => {
    void load();

    let disposed = false;
    let disposers: UnlistenFn[] = [];

    void (async () => {
      try {
        const subscriptions = await Promise.all([
          on("run:progress", (event) => setProgress({ done: event.done, total: event.total })),
          on("run:requirement", (requirement) => {
            // They arrive one at a time, so the table fills as it goes.
            if (live.current) setRequirements((previous) => [...previous, requirement]);
          }),
          on("run:problem", (problem) =>
            setProblems((previous) => [...previous, `batch ${problem.batch}: ${problem.detail}`]),
          ),
          on("run:finished", (finished) => {
            live.current = false;
            setRun(finished);
            setPhase("idle");
            void load();
          }),
        ]);
        if (disposed) subscriptions.forEach((off) => off());
        else disposers = subscriptions;
      } catch (cause: unknown) {
        setError(`could not follow the run: ${describeError(cause)}`);
      }
    })();


  return () => {
      disposed = true;
      disposers.forEach((off) => off());
    };
  }, [project.path]);

  async function load() {
    try {
      const [list, runs, designed, written] = await Promise.all([
        call("requirement_list", { projectPath: project.path }),
        call("run_list", { projectPath: project.path }),
        call("scenario_list", { projectPath: project.path }),
        call("case_list", { projectPath: project.path }),
      ]);
      setRequirements(list);
      setScenarios(designed);
      setCases(written);
      setRun(runs.filter((entry) => entry.kind === "extract").at(-1) ?? null);
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  async function prepare() {
    setPhase("estimating");
    setError(null);
    try {
      setPlan(await call("extract_plan", { projectPath: project.path }));
      setPhase("ready");
    } catch (cause: unknown) {
      setError(describeError(cause));
      setPhase("idle");
    }
  }

  async function start(delta: boolean) {
    setPhase("running");
    setProblems([]);
    // A delta keeps what is already there; a full read starts again.
    if (!delta) setRequirements([]);
    setProgress({ done: 0, total: plan?.estimate.batches ?? 0 });
    live.current = true;
    try {
      await call("extract_run", { projectPath: project.path, delta });
    } catch (cause: unknown) {
      setError(describeError(cause));
      live.current = false;
      setPhase("idle");
      await load();
    }
  }

  const chosen = requirements.find((requirement) => requirement.id === selected) ?? null;

  /** What has been built on a requirement, and how much of it is behind. */
  function builtOn(reqId: string) {
    const theirs = cases.filter((entry) => entry.reqId === reqId);
    const version = requirements.find((entry) => entry.id === reqId)?.version ?? 1;
    return {
      scenarios: scenarios.filter((entry) => entry.reqId === reqId).length,
      cases: theirs.length,
      stale: theirs.filter((entry) => entry.reqVersion < version).length,
    };
  }
  const vague = requirements.filter((requirement) => requirement.flag === "vague").length;
  /** Requirements nothing has been designed from. Easy to miss in a list of
   *  a hundred, and the reason a coverage screen reads lower than expected. */
  const undesigned = requirements.filter(
    (requirement) =>
      !requirement.orphaned && !scenarios.some((scenario) => scenario.reqId === requirement.id),
  ).length;
  const orphans = requirements.filter((requirement) => requirement.orphaned);
  /** Orphans someone had worked on — not the same as ones the app produced. */
  const touched = orphans.filter((requirement) => requirement.editedBy.length > 0);

  useDetail(
    chosen ? (
      <RequirementDetail
        project={project}
        requirement={chosen}
        built={builtOn(chosen.id)}
        onChanged={() => void load()}
      />
    ) : null,
    [selected, requirements.length],
    () => setSelected(null),
  );

  return (
    <div className="stack">
      <section className="card">
        <header className="panel-head">
          <h2>Requirements</h2>
          {requirements.length > 0 && (
            <span className="pill pill-unknown">
              {requirements.length} · {vague} vague
            </span>
          )}
        </header>

        {phase === "idle" && requirements.length === 0 && (
          <p className="hint">Nothing read yet. Add a document, then read it.</p>
        )}

        {undesigned > 0 && (
          <p className="hint">
            {undesigned} of {requirements.length} have no scenarios yet. Test Design → Scenarios
            picks up every requirement that has none, and skips the ones still flagged vague.
          </p>
        )}

        <div className="actions">
          <button type="button" disabled={phase === "running"} onClick={() => void prepare()}>
            {requirements.length > 0 ? "Read again" : "Read the documents"}
          </button>

          {requirements.length > 0 && (
            <button
              type="button"
              className="ghost"
              disabled={checking || phase === "running"}
              onClick={() => {
                setChecking(true);
                setError(null);
                void call("judge_review", { projectPath: project.path })
                  .then(setReview)
                  .catch((cause: unknown) => setError(describeError(cause)))
                  .finally(() => setChecking(false));
              }}
            >
              {checking ? "Checking…" : "Check the set"}
            </button>
          )}

          {requirements.length > 0 && (
            <button
              type="button"
              className="ghost"
              onClick={() =>
                void call("requirements_export", { projectPath: project.path })
                  .then(setExported)
                  .catch((cause: unknown) => setError(describeError(cause)))
              }
            >
              Export CSV
            </button>
          )}

          {phase === "running" && (
            <button type="button" className="ghost danger" onClick={() => void call("extract_cancel", {})}>
              Stop
            </button>
          )}
        </div>

        {exported && <p className="hint">Written to {exported}</p>}
        {error && <p className="warn">{error}</p>}

        {phase === "ready" && plan && (
          <div className="estimate">
            <div className="facts">
              <div>
                <dt>New pieces</dt>
                <dd>{plan.newPieces}</dd>
              </div>
              <div>
                <dt>Unchanged</dt>
                <dd>{plan.unchangedPieces}</dd>
              </div>
              <div>
                <dt>Requirements kept</dt>
                <dd>{plan.keep}</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>
                  {plan.estimate.cost !== null
                    ? `$${plan.estimate.cost.toFixed(2)}`
                    : `${(plan.estimate.inputTokens + plan.estimate.outputTokens).toLocaleString()} tokens`}
                </dd>
              </div>
            </div>
            <p className={plan.estimate.overBudget ? "warn" : "hint"}>{plan.note}</p>
            <div className="actions">
              <button
                type="button"
                disabled={
                  plan.estimate.model === null || plan.estimate.overBudget || plan.newPieces === 0
                }
                onClick={() => void start(true)}
              >
                {plan.firstRun ? "Read them" : `Read the ${plan.newPieces} new pieces`}
              </button>
              {!plan.firstRun && (
                <button
                  type="button"
                  className="ghost danger"
                  disabled={plan.estimate.model === null}
                  onClick={() => void start(false)}
                >
                  Start again from scratch
                </button>
              )}
              <button type="button" className="ghost" onClick={() => setPhase("idle")}>
                Not now
              </button>
            </div>
          </div>
        )}

        {phase === "running" && progress && (
          <p className="hint">
            Reading… {progress.done} of {progress.total} requests · {requirements.length} found so far
          </p>
        )}

        {problems.map((problem) => (
          <p className="warn" key={problem}>
            {problem}
          </p>
        ))}

        {orphans.length > 0 && (
          <div className="estimate">
            <p className="warn">
              {orphans.length} requirements no longer have a paragraph in any document. They are
              kept until you say otherwise.
            </p>
            {touched.length > 0 && (
              <p className="warn">
                {touched.length} of them had been edited by hand: {touched.map((entry) => entry.id).join(", ")}.
                Their paragraph changed in the document, but the thinking in them was someone's.
                Read them before letting them go — a tidy-up is not how that should disappear.
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                className="ghost danger"
                onClick={() =>
                  void call("requirements_drop_orphans", {
                    projectPath: project.path,
                    includeEdited: false,
                  })
                    .then(() => load())
                    .catch((cause: unknown) => setError(describeError(cause)))
                }
              >
                Drop the {orphans.length - touched.length} nobody edited
              </button>
              {touched.length > 0 && (
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => {
                    if (
                      !confirm(
                        `Drop all ${orphans.length}, including the ${touched.length} that were edited by hand?`,
                      )
                    ) {
                      return;
                    }
                    void call("requirements_drop_orphans", {
                      projectPath: project.path,
                      includeEdited: true,
                    })
                      .then(() => load())
                      .catch((cause: unknown) => setError(describeError(cause)));
                  }}
                >
                  Drop all {orphans.length}, edited ones included
                </button>
              )}
            </div>
          </div>
        )}

        {run && phase !== "running" && (
          <p className="hint">
            {run.id} · {run.status} · {run.produced} requirements · {run.attempts} attempts ·{" "}
            {(run.inputTokens + run.outputTokens).toLocaleString()} tokens
            {run.cost !== null ? ` · $${run.cost.toFixed(2)}` : ""}
            {run.note ? ` · ${run.note}` : ""}
          </p>
        )}
        {review && (
          <div className="estimate">
            <p className={review.findings.length > 0 ? "warn" : "hint"}>
              {review.findings.length === 0
                ? `Checked all ${review.checked}. Nothing looks wrong.`
                : `${review.findings.length} to look at, out of ${review.checked}.`}
            </p>
            <div className="rows">
              {(showUnsure ? [...review.findings, ...review.unsure] : review.findings)
                .slice(0, 20)
                .map((finding) => (
                <div
                  className="row"
                  key={`${finding.kind}-${finding.id}-${finding.other ?? ""}`}
                  onClick={() => setSelected(finding.id)}
                >
                  <span className="row-main">
                    {finding.kind === "vague"
                      ? `${finding.id} is hard to test`
                      : `${finding.id} and ${finding.other} say the same thing`}
                  </span>
                  <span className="row-sub">{finding.why}</span>
                  <Pill kind={finding.action === "act" ? "bad" : finding.action === "verify" ? "warn" : "plain"}>
                    {finding.action === "act"
                      ? "clear"
                      : finding.action === "verify"
                        ? "worth a look"
                        : "not sure"}
                  </Pill>
                </div>
              ))}
              {review.findings.length > 20 && (
                <p className="hint">{review.findings.length - 20} more not shown.</p>
              )}
            </div>

            {review.unsure.length > 0 && (
              <div className="actions">
                <button type="button" className="ghost" onClick={() => setShowUnsure(!showUnsure)}>
                  {showUnsure
                    ? `Hide the ${review.unsure.length} it could not decide`
                    : `Show ${review.unsure.length} it could not decide`}
                </button>
                <span className="hint">
                  A yes it has no conviction about. Worth a glance, not worth acting on.
                </span>
              </div>
            )}
            {review.failed !== undefined && (
              <p className="warn">
                {review.failed} {review.failed === 1 ? "request" : "requests"} failed, so some
                questions went unanswered — {review.failure}
              </p>
            )}
            <p className="hint">
              Answered by {review.mode === "rules" ? "the rules" : (review.model ?? review.mode)}
              {review.asked > 0
                ? ` · ${review.asked} questions · ${(review.inputTokens + review.outputTokens).toLocaleString()} tokens`
                : " · nothing sent anywhere"}
              {review.cost !== undefined ? ` · $${review.cost.toFixed(4)}` : ""}
              {review.mode !== review.asked_for ? ` · ${review.note}` : ""}
            </p>
          </div>
        )}
      </section>

        <Table
          columns={[
            { label: "ID", width: 76 },
            { label: "Requirement" },
            { label: "Acceptance", width: 260 },
            { label: "Source", width: 150 },
            { label: "Flag", width: 86 },
          ]}
          empty="Nothing read yet."
          rows={requirements.map((requirement) => ({
            id: requirement.id,
            selected: requirement.id === selected,
            muted: requirement.orphaned,
            onSelect: () => setSelected(requirement.id),
            cells: [
              <span className="mono">{requirement.id}</span>,
              requirement.title,
              <span className="sub">{requirement.acceptance || "not given"}</span>,
              <span className="mono">
                {requirement.source.document}
                {requirement.source.page !== null ? ` p${requirement.source.page}` : ""}
              </span>,
              <>
                <Pill kind={requirement.orphaned ? "bad" : requirement.flag === "vague" ? "warn" : "ok"}>
                  {requirement.orphaned ? "no source" : requirement.flag}
                </Pill>
                {builtOn(requirement.id).stale > 0 && (
                  <span className="sub">
                    v{requirement.version} · {builtOn(requirement.id).stale} behind
                  </span>
                )}
              </>,
            ],
          }))}
        />

    </div>
  );
}
