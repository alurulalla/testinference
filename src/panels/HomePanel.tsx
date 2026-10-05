import { useEffect, useState } from "react";
import type { View } from "../Shell";
import { call, describeError } from "../lib/ipc";
import type { CoverageReport, OpenProject, Run, Summary } from "../types/api";

interface Props {
  project: OpenProject | null;
  summary: Summary | null;
  onView: (view: View) => void;
}

/** One step of the cycle, as the wireframe draws it. */
function Step({
  label,
  note,
  state,
}: {
  label: string;
  note: string;
  state: "done" | "now" | "todo";
}) {
  return (
    <div className="cycle-step">
      <span className={`cycle-mark cycle-${state}`}>{state === "done" ? "✓" : state === "now" ? "●" : ""}</span>
      <span className="cycle-label">{label}</span>
      <span className="cycle-note">{note}</span>
    </div>
  );
}

export default function HomePanel({ project, summary, onView }: Props) {
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    void Promise.all([
      call("coverage_get", { projectPath: project.path }),
      call("run_list", { projectPath: project.path }),
    ])
      .then(([report, runList]) => {
        setCoverage(report);
        setRuns(runList);
      })
      .catch((cause: unknown) => setError(describeError(cause)));
  }, [project?.path, summary?.requirements, summary?.cases]);

  if (!project) {
    return (
      <section className="card">
        <h1>No project open</h1>
        <p className="hint">Open or create one to begin.</p>
        <div className="actions">
          <button type="button" onClick={() => onView("projects")}>
            Projects
          </button>
        </div>
      </section>
    );
  }

  const waitingA = summary?.pendingGateA ?? 0;
  const waitingB = summary?.pendingGateB ?? 0;
  const waiting = waitingA + waitingB;
  const bandOne = coverage?.risk.bands["P1"] ?? 0;

  const step = (done: boolean, now: boolean): "done" | "now" | "todo" =>
    now ? "now" : done ? "done" : "todo";

  // Money spent, grouped by the model that spent it.
  const spend = new Map<string, { calls: number; cost: number }>();
  for (const run of runs) {
    const entry = spend.get(run.model) ?? { calls: 0, cost: 0 };
    entry.calls += run.batches;
    entry.cost += run.cost ?? 0;
    spend.set(run.model, entry);
  }

  const decisions: Array<[string, string, string, View]> = [];
  if (waitingA) {
    decisions.push([
      `Gate A · ${waitingA} scenarios waiting`,
      `${bandOne} in risk band P1 · designed by your assigned model`,
      "Review",
      "gatea",
    ]);
  }
  if (summary?.vague) {
    decisions.push([
      `${summary.vague} requirements are too vague to test`,
      "they will show as coverage gaps until the wording is settled",
      "Open",
      "requirements",
    ]);
  }
  if (waitingB) {
    decisions.push([`Gate B · ${waitingB} cases waiting`, "approve what gets published", "Review", "gateb"]);
  }
  if (summary?.orphaned) {
    decisions.push([
      `${summary.orphaned} requirements have no source`,
      "their paragraph has gone from the document",
      "Open",
      "requirements",
    ]);
  }

  return (
    <div className="stack">
      <section className="card home-head">
        <div>
          <h1>{project.name}</h1>
          <p className="hint">
            {project.appUrl || "no application URL"} · {summary?.documents ?? 0} documents · context
            saved locally
          </p>
        </div>
        <span className="spacer" />
        <button type="button" className="ghost" onClick={() => onView("documents")}>
          Add documents
        </button>
        <button type="button" onClick={() => onView(waitingA ? "gatea" : "requirements")}>
          {waitingA ? "Continue at Gate A" : "Open requirements"}
        </button>
      </section>

      <section className="card">
        <p className="hint">
          <strong>This cycle</strong> — approved work carries on while the rest waits at a gate
        </p>
        <div className="cycle">
          <Step label="Documents" note={`${summary?.documents ?? 0} read`} state={step((summary?.documents ?? 0) > 0, false)} />
          <Step
            label="Requirements"
            note={`${summary?.requirements ?? 0} · ${summary?.vague ?? 0} vague`}
            state={step((summary?.requirements ?? 0) > 0, false)}
          />
          <Step
            label="Scenarios"
            note={`${summary?.scenarios ?? 0} designed`}
            state={step((summary?.scenarios ?? 0) > 0, false)}
          />
          <Step
            label="Gate A"
            note={waitingA ? `${waitingA} waiting` : "clear"}
            state={step((summary?.approvedScenarios ?? 0) > 0, waitingA > 0)}
          />
          <Step label="TCER" note={`${summary?.rows ?? 0} rows`} state={step((summary?.rows ?? 0) > 0, false)} />
          <Step
            label="Test cases"
            note={`${summary?.cases ?? 0} written`}
            state={step((summary?.cases ?? 0) > 0, false)}
          />
          <Step
            label="Publish"
            note={summary?.published ? `${summary.published} published` : "not yet"}
            state={step((summary?.published ?? 0) > 0, false)}
          />
        </div>
      </section>

      <div className="tiles">
        <div className="tile">
          <span className="tile-label">Requirement coverage</span>
          <span className="tile-value">{coverage ? `${coverage.coverage.percent}%` : "—"}</span>
          <span className="tile-note">
            {coverage
              ? `${coverage.coverage.covered} of ${coverage.coverage.lines.length} · ${coverage.coverage.gap} gap, ${coverage.coverage.partial} partial`
              : "nothing measured yet"}
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">Scenarios</span>
          <span className="tile-value">{summary?.scenarios ?? 0}</span>
          <span className="tile-note">{bandOne} in band P1</span>
        </div>
        <div className="tile">
          <span className="tile-label">Cases ready</span>
          <span className="tile-value">{summary?.approvedCases ?? 0}</span>
          <span className="tile-note">{(summary?.cases ?? 0) - (summary?.approvedCases ?? 0)} not yet approved</span>
        </div>
        <div className="tile">
          <span className="tile-label">Waiting on you</span>
          <span className="tile-value warn-value">{waiting}</span>
          <span className="tile-note">
            {waitingA} at Gate A, {waitingB} at Gate B
          </span>
        </div>
      </div>

      <div className="home-split">
        <section className="card">
          <h2>
            Needs your decision <span className="hint">· riskiest first</span>
          </h2>
          {decisions.length === 0 ? (
            <p className="hint">Nothing is waiting.</p>
          ) : (
            <div className="rows">
              {decisions.map(([title, note, action, target]) => (
                <div className="row" key={title}>
                  <span className="row-main">{title}</span>
                  <span className="row-sub">{note}</span>
                  <button type="button" className={action === "Review" ? "" : "ghost"} onClick={() => onView(target)}>
                    {action}
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && <p className="warn">{error}</p>}
        </section>

        <section className="card">
          <h2>
            AI this cycle <span className="hint">· your own keys</span>
          </h2>
          {spend.size === 0 ? (
            <p className="hint">Nothing spent yet.</p>
          ) : (
            <div className="rows">
              {[...spend.entries()].map(([model, entry]) => (
                <div className="row" key={model}>
                  <span className="row-main">{model}</span>
                  <span className="row-sub">{entry.calls} requests</span>
                  <span className="mono">{entry.cost > 0 ? `$${entry.cost.toFixed(2)}` : "unpriced"}</span>
                </div>
              ))}
              <div className="row">
                <span className="row-main">Jev · switched off</span>
                <span className="row-sub">rules and on-device checks used instead</span>
              </div>
            </div>
          )}
          <p className="hint">
            Explore, Runs, Failures and Dashboards arrive in a later release.
          </p>
        </section>
      </div>
    </div>
  );
}
