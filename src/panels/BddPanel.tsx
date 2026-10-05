import { useEffect, useState } from "react";
import { call, describeError } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import { useDetail } from "../ui/detail";
import type { BddCase, BddEstimate, OpenProject, Run } from "../types/api";

export default function BddPanel({ project }: { project: OpenProject }) {
  const [cases, setCases] = useState<BddCase[]>([]);
  const [library, setLibrary] = useState<string[]>([]);
  const [estimate, setEstimate] = useState<BddEstimate | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [project.path]);

  async function load() {
    try {
      const [list, steps, runs] = await Promise.all([
        call("bdd_list", { projectPath: project.path }),
        call("steps_list", { projectPath: project.path }),
        call("run_list", { projectPath: project.path }),
      ]);
      setCases(list);
      setLibrary(steps);
      setRun(runs.filter((entry) => entry.kind === "bdd").at(-1) ?? null);
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  const chosen = cases.find((entry) => entry.id === selected) ?? null;
  const features = [...new Set(cases.map((entry) => entry.feature))];

  useDetail(
    chosen ? (
      <>
        <header className="panel-head">
          <h2>{chosen.feature}.feature</h2>
          <Pill kind="plain">{chosen.id}</Pill>
        </header>
        <pre className="gherkin">
          {[
            `${chosen.examples ? "Scenario Outline" : "Scenario"}: ${chosen.title}`,
            ...chosen.given.split("\n"),
            ...chosen.when.split("\n"),
            ...chosen.then.split("\n"),
            ...(chosen.examples ? ["", "Examples:", ...chosen.examples.split("\n")] : []),
          ].join("\n")}
        </pre>
        <p className="hint">
          {chosen.caseId} · {chosen.reqId} · {chosen.priority}
          {chosen.platform ? ` · ${chosen.platform}` : ""}
          {chosen.newSteps.length > 0
            ? ` · ${chosen.newSteps.length} steps added to the library`
            : " · every step came from the library"}
        </p>
      </>
    ) : showLibrary && library.length > 0 ? (
      <>
        <h2>Step library · {library.length}</h2>
        <p className="hint">
          Reused across features so a suite reads the same way throughout. With judgement set to
          Jev, a step is reused when it means the same thing, not only when it is worded the same;
          otherwise matching is on wording alone.
        </p>
        <pre className="gherkin">{library.join("\n")}</pre>
      </>
    ) : null,
    [selected, library.length, showLibrary],
    chosen ? () => setSelected(null) : () => setShowLibrary(false),
  );

  return (
    <div className="stack">
      <section className="card">
        <header className="panel-head">
          <h2>BDD</h2>
          {cases.length > 0 && (
            <span className="pill pill-unknown">
              {cases.length} outlines · {features.length} features · {library.length} steps
            </span>
          )}
          {library.length > 0 && !showLibrary && (
            <button type="button" className="ghost" onClick={() => setShowLibrary(true)}>
              Show the step library
            </button>
          )}
        </header>

        {cases.length === 0 && <p className="hint">Nothing yet. Write some test cases first.</p>}

        <div className="actions">
          <button
            type="button"
            disabled={running}
            onClick={() =>
              void call("bdd_estimate", { projectPath: project.path })
                .then(setEstimate)
                .catch((cause: unknown) => setError(describeError(cause)))
            }
          >
            {cases.length > 0 ? "Write again" : "Write the Gherkin"}
          </button>
        </div>

        {error && <p className="warn">{error}</p>}

        {estimate && !running && (
          <div className="estimate">
            <div className="facts">
              <div>
                <dt>Cases</dt>
                <dd>{estimate.cases}</dd>
              </div>
              <div>
                <dt>Steps to reuse</dt>
                <dd>{estimate.library}</dd>
              </div>
              <div>
                <dt>Requests</dt>
                <dd>{estimate.batches}</dd>
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
                disabled={estimate.model === null || estimate.overBudget || estimate.cases === 0}
                onClick={() => {
                  setRunning(true);
                  setEstimate(null);
                  void call("bdd_run", { projectPath: project.path })
                    .catch((cause: unknown) => setError(describeError(cause)))
                    .finally(() => {
                      setRunning(false);
                      void load();
                    });
                }}
              >
                Write them
              </button>
              <button type="button" className="ghost" onClick={() => setEstimate(null)}>
                Not now
              </button>
            </div>
          </div>
        )}

        {running && <p className="hint">Writing Gherkin and folding steps into the library…</p>}

        {run && !running && (
          <p className="hint">
            {run.id} · {run.status} · {run.note ?? ""}
            {run.cost !== null ? ` · $${run.cost.toFixed(2)}` : ""}
          </p>
        )}

        {cases.length > 0 && (
          <p className="hint">
            Feature files are written to .testinference/bdd/ and run as they are. Step reuse is
            matched on wording for now; it becomes a match on meaning when the local index lands.
          </p>
        )}
      </section>

      <section className="card">
        <Table
          columns={[
            { label: "ID", width: 84 },
            { label: "Scenario outline" },
            { label: "Feature file", width: 160 },
            { label: "Shape", width: 130 },
            { label: "New", width: 60, align: "right" },
          ]}
          empty="Nothing written yet."
          rows={cases.map((entry) => ({
            id: entry.id,
            selected: entry.id === selected,
            onSelect: () => setSelected(entry.id),
            cells: [
              <span className="mono">{entry.id}</span>,
              <>
                {entry.title}
                <span className="sub">
                  {entry.caseId} · {entry.reqId}
                </span>
              </>,
              <span className="mono">{entry.feature}.feature</span>,
              entry.examples ? (
                <Pill kind="ok">outline with examples</Pill>
              ) : (
                <Pill kind="plain">plain scenario</Pill>
              ),
              entry.newSteps.length,
            ],
          }))}
        />
      </section>


    </div>
  );
}
