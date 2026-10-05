import { useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { call, describeError, on } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import { useDetail } from "../ui/detail";
import type { Balance, Judged, DesignPlan, Estimate, OpenProject, RankedScenario, Run, Scenario } from "../types/api";

type Phase = "idle" | "ready" | "running";

export default function ScenariosPanel({ project, gate }: { project: OpenProject; gate: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [plan, setPlan] = useState<DesignPlan | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [ranked, setRanked] = useState<RankedScenario[]>([]);
  const [balance, setBalance] = useState<Balance[]>([]);
  const [gaps, setGaps] = useState<Judged<boolean>[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
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
          on("run:scenario", (scenario) => {
            if (live.current) setScenarios((previous) => [...previous, scenario]);
          }),
          on("run:finished", (finished) => {
            if (finished.kind !== "design") return;
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
      const [list, runs] = await Promise.all([
        call("scenario_list", { projectPath: project.path }),
        call("run_list", { projectPath: project.path }),
      ]);
      setScenarios(list);
      setRun(runs.filter((entry) => entry.kind === "design").at(-1) ?? null);

      if (list.length > 0) {
        const review = await call("scenario_review", { projectPath: project.path });
        setRanked(review.ranked.ranked);
        setBalance(review.balance.filter((line) => line.note !== null));
        // Only gaps a judge was actually sure about. On real data the
        // broad question came back at 2% confidence on plenty of them,
        // which is the judge shrugging — listing those under "not covered"
        // would read conviction into a shrug. The rule's own panel below
        // still shows everything it counts.
        setGaps(
          (review.enough?.answers ?? []).filter(
            (entry) => entry.answer === false && entry.by === "jev" && entry.confidence >= 0.5,
          ),
        );
      } else {
        setRanked([]);
        setBalance([]);
      }
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  async function decide(ids: string[], verdict: "approved" | "rejected") {
    try {
      await call("scenario_decide", { projectPath: project.path, ids, verdict });
      await load();
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  const [picked, setPicked] = useState<string | null>(null);
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  // Gate A shows the riskiest first, because that is the order attention
  // should be spent in.
  const ordered = ranked.length > 0 ? ranked.map((entry) => byId.get(entry.id)).filter(Boolean) as Scenario[] : scenarios;
  const scoreOf = new Map(ranked.map((entry) => [entry.id, entry]));
  const waiting = scenarios.filter((scenario) => scenario.state === "pending");
  const chosen = scenarios.find((scenario) => scenario.id === picked) ?? null;
  const chosenScore = chosen ? scoreOf.get(chosen.id) : undefined;

  useDetail(
    gate && chosen ? (
      <>
        <h2>{chosen.id}</h2>
        <p className="lede">{chosen.title}</p>

        <span className="aside-label">The test, in full</span>
        <span className="aside-value">
          <strong>Before:</strong> {chosen.precondition || "not given"}
          <br />
          <strong>Do:</strong> {chosen.trigger || "not given"}
          <br />
          <strong>Expect:</strong> {chosen.expected || "not given"}
        </span>

        {chosenScore && (
          <>
            <span className="aside-label">
              Risk {chosenScore.score} = band {chosenScore.band}
            </span>
            <span className="aside-value">
              {chosenScore.factors} · {chosenScore.arithmetic}
            </span>
          </>
        )}

        <span className="aside-label">Traces to</span>
        <span className="aside-value">{chosen.reqId}</span>

        <span className="aside-label">Written by</span>
        <span className="aside-value">
          {chosen.madeBy.model} · {chosen.madeBy.prompt}
        </span>

        <p className="hint">Nothing is written until you approve.</p>
      </>
    ) : null,
    [gate, picked, scenarios.length],
  () => setPicked(null),
);

  return (
    <div className="stack">
      <section className="card">
        <header className="panel-head">
          <h2>Scenarios</h2>
          {scenarios.length > 0 && (
            <span className="pill pill-unknown">
              {scenarios.length} · {waiting.length} waiting on you
            </span>
          )}
        </header>

        {scenarios.length === 0 && phase === "idle" && (
          <p className="hint">Nothing designed yet. Read some requirements first, then design from them.</p>
        )}

        <div className="actions">
          <button
            type="button"
            disabled={phase === "running"}
            onClick={() =>
              void Promise.all([
                call("design_estimate", { projectPath: project.path }),
                call("design_plan", { projectPath: project.path }),
              ])
                .then(([result, planned]) => {
                  setEstimate(result);
                  setPlan(planned);
                  setPhase("ready");
                })
                .catch((cause: unknown) => setError(describeError(cause)))
            }
          >
            {scenarios.length > 0 ? "Design again" : "Design scenarios"}
          </button>

          {gate && waiting.length > 0 && (
            <>
              {(["P3", "P2", "P1"] as const).map((band) => {
                const inBand = waiting.filter((scenario) => scoreOf.get(scenario.id)?.band === band);
                if (inBand.length === 0) return null;
                return (
                  <button
                    key={band}
                    type="button"
                    className="ghost"
                    onClick={() => void decide(inBand.map((scenario) => scenario.id), "approved")}
                  >
                    Approve {inBand.length} in band {band}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => void decide(waiting.map((scenario) => scenario.id), "approved")}
              >
                Approve all {waiting.length}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (confirm(`Reject all ${waiting.length} scenarios still waiting?`)) {
                    void decide(waiting.map((scenario) => scenario.id), "rejected");
                  }
                }}
              >
                Reject all remaining
              </button>
            </>
          )}

          {phase === "running" && (
            <button type="button" className="ghost danger" onClick={() => void call("extract_cancel", {})}>
              Stop
            </button>
          )}
        </div>

        {error && <p className="warn">{error}</p>}

        {phase === "ready" && estimate && (
          <div className="estimate">
            <div className="facts">
              <div>
                <dt>Without scenarios</dt>
                <dd>{plan?.toDesign ?? estimate.requirements ?? 0}</dd>
              </div>
              <div>
                <dt>Already designed</dt>
                <dd>{plan?.withScenarios ?? 0}</dd>
              </div>
              <div>
                <dt>Requests</dt>
                <dd>{estimate.batches}</dd>
              </div>
              <div>
                <dt>Tokens, roughly</dt>
                <dd>{(estimate.inputTokens + estimate.outputTokens).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{estimate.model ?? "none assigned"}</dd>
              </div>
            </div>
            <p className={estimate.overBudget ? "warn" : "hint"}>{estimate.note}</p>
            <div className="actions">
              <button
                type="button"
                disabled={estimate.model === null || estimate.overBudget}
                onClick={() => {
                  setPhase("running");
                  live.current = true;
                  void call("design_run", { projectPath: project.path, delta: true }).catch((cause: unknown) => {
                    setError(describeError(cause));
                    live.current = false;
                    setPhase("idle");
                    void load();
                  });
                }}
              >
                {plan && plan.withScenarios > 0
                  ? `Design for the ${plan.toDesign} without scenarios`
                  : "Design them"}
              </button>
              <button
                type="button"
                className="ghost danger"
                onClick={() => {
                  setPhase("running");
                  setScenarios([]);
                  live.current = true;
                  void call("design_run", { projectPath: project.path, delta: false }).catch(
                    (cause: unknown) => {
                      setError(describeError(cause));
                      live.current = false;
                      setPhase("idle");
                      void load();
                    },
                  );
                }}
              >
                Design everything again
              </button>
              <button type="button" className="ghost" onClick={() => setPhase("idle")}>
                Not now
              </button>
            </div>
          </div>
        )}

        {phase === "running" && progress && (
          <p className="hint">
            Designing… {progress.done} of {progress.total} requests · {scenarios.length} so far
          </p>
        )}

        {run && phase !== "running" && (
          <p className="hint">
            {run.id} · {run.status} · {run.produced} scenarios · {run.attempts} attempts
            {run.cost !== null ? ` · $${run.cost.toFixed(2)}` : ""}
            {run.note ? ` · ${run.note}` : ""}
          </p>
        )}
      </section>

      {!gate && gaps.length > 0 && (
        <section className="card">
          <header className="panel-head">
            <h2>Not covered well enough</h2>
            <Pill kind="warn">{gaps.length}</Pill>
          </header>
          <p className="hint">
            The judge read each requirement with the scenarios written for it and said these are
            not enough yet. This is a different question from the counting below: a requirement can
            have a working case and a failing case and still miss the point.
          </p>
          <Table
            columns={[
              { label: "Requirement", width: 110 },
              { label: "What the judge said" },
              { label: "Sure", width: 70, align: "right" },
            ]}
            rows={gaps.map((entry) => ({
              id: entry.id,
              cells: [
                <span className="mono">{entry.id}</span>,
                entry.why,
                `${Math.round(entry.confidence * 100)}%`,
              ],
            }))}
          />
        </section>
      )}

      {!gate && balance.length > 0 && (
        <section className="card">
          <header className="panel-head">
            <h2>Before you approve</h2>
            <Pill kind="warn">{balance.length}</Pill>
          </header>
          <p className="hint">
            Every requirement should have a scenario for it working and one for it failing. These do
            not. "No scenarios" usually means the requirement was too vague to design from — fix the
            wording and design again. "Nothing tests this failing" means only the happy path was
            written, so a broken error path would go unnoticed.
          </p>
          <Table
            columns={[
              { label: "Requirement", width: 110 },
              { label: "What is missing" },
              { label: "Scenarios", width: 80, align: "right" },
            ]}
            rows={balance.map((line) => ({
              id: line.reqId,
              cells: [<span className="mono">{line.reqId}</span>, line.note, line.scenarios],
            }))}
          />
        </section>
      )}

      {!gate && scenarios.length > 0 && (
        <section className="card">
          <header className="panel-head">
            <h2>Scenarios</h2>
            <Pill kind="plain">{scenarios.length}</Pill>
          </header>
          <Table
            columns={[
              { label: "ID", width: 68 },
              { label: "Scenario" },
              { label: "From", width: 78 },
              { label: "Class", width: 96 },
              { label: "Priority", width: 72 },
              { label: "Automation", width: 100 },
              { label: "State", width: 88 },
            ]}
            rows={scenarios.map((scenario) => ({
              id: scenario.id,
              muted: scenario.state === "rejected",
              cells: [
                <span className="mono">{scenario.id}</span>,
                <>
                  {scenario.title}
                  {scenario.expected ? <span className="sub">expects: {scenario.expected}</span> : null}
                </>,
                <span className="mono">{scenario.reqId}</span>,
                scenario.class,
                scenario.priority,
                scenario.autoFeasibility,
                <Pill
                  kind={
                    scenario.state === "approved" ? "ok" : scenario.state === "rejected" ? "bad" : "warn"
                  }
                >
                  {scenario.state}
                </Pill>,
              ],
            }))}
          />
        </section>
      )}

      {gate && ordered.length > 0 && (
        <section className="card">
          <header className="panel-head">
            <h2>Gate A · approve what gets tested</h2>
            <Pill kind="plain">riskiest first</Pill>
          </header>
          <Table
            columns={[
              { label: "ID", width: 68 },
              { label: "Scenario" },
              { label: "From", width: 78 },
              { label: "Class", width: 88 },
              { label: "Risk", width: 108, align: "right" },
              { label: "", width: 168 },
            ]}
            rows={ordered.map((scenario) => {
              const score = scoreOf.get(scenario.id);
              return {
                id: scenario.id,
                muted: scenario.state === "rejected",
                selected: scenario.id === picked,
                onSelect: () => setPicked(scenario.id),
                cells: [
                  <span className="mono">{scenario.id}</span>,
                  <>
                    {scenario.title}
                    {scenario.expected ? <span className="sub">expects: {scenario.expected}</span> : null}
                  </>,
                  <span className="mono">{scenario.reqId}</span>,
                  <>
                    {scenario.class}
                    <span className="sub">
                      {scenario.priority} · {scenario.autoFeasibility}
                    </span>
                  </>,
                  score ? (
                    <>
                      {score.score}
                      <span className="sub">{score.arithmetic}</span>
                    </>
                  ) : (
                    "—"
                  ),
                  scenario.state === "pending" ? (
                    <span className="inline-actions">
                      <button type="button" onClick={() => void decide([scenario.id], "approved")}>
                        Approve
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void decide([scenario.id], "rejected")}
                      >
                        Reject
                      </button>
                    </span>
                  ) : (
                    <span className="inline-actions">
                      <Pill kind={scenario.state === "approved" ? "ok" : "bad"}>{scenario.state}</Pill>
                    </span>
                  ),
                ],
              };
            })}
          />
        </section>
      )}
    </div>
  );
}
