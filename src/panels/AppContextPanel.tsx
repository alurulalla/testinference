import { useEffect, useState } from "react";
import { call, describeError } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import type { DocumentRecord, OpenProject, Run, Summary } from "../types/api";

/** What the project remembers, and which of it travels to the repository. */
const STORED: Array<[string, string, boolean]> = [
  ["requirements/", "one file per requirement", true],
  ["scenarios/", "one file per scenario", true],
  ["tcer/", "completed rows with their scores", true],
  ["cases/", "test cases", true],
  ["bdd/", "real .feature files and their records", true],
  ["steps/", "the step library", true],
  ["suites/", "feature, regression and release", true],
  ["decisions/", "every approval and edit, appended", true],
  ["documents/", "fingerprints and page counts only", true],
  ["runs/", "model, prompt version, cost, attempts", true],
  ["your documents", "the files themselves, kept on this machine", false],
  ["search index", "pieces and their numbers, rebuildable", false],
];

export default function AppContextPanel({
  project,
  summary,
}: {
  project: OpenProject;
  summary: Summary | null;
}) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      call("document_list", { projectPath: project.path }),
      call("run_list", { projectPath: project.path }),
      call("steps_list", { projectPath: project.path }),
    ])
      .then(([documentList, runList, stepList]) => {
        setDocuments(documentList);
        setRuns(runList);
        setSteps(stepList);
      })
      .catch((cause: unknown) => setError(describeError(cause)));
  }, [project.path]);

  const counts = project.counts.reduce((total, count) => total + count.files, 0);

  return (
    <div className="stack">
      <section className="card">
        <header className="panel-head">
          <h2>App context</h2>
          <Pill kind="plain">{counts} records</Pill>
        </header>
        <p className="hint">
          Everything this project knows, saved as plain files. No document text and no secrets are
          kept here — fingerprints and references only.
        </p>
        {error && <p className="warn">{error}</p>}

        <div className="tiles">
          {[
            ["Documents read", summary?.documents ?? 0, `${documents.reduce((n, d) => n + d.chunks, 0)} pieces`],
            ["Requirements", summary?.requirements ?? 0, `${summary?.vague ?? 0} vague`],
            ["Scenarios", summary?.scenarios ?? 0, `${summary?.approvedScenarios ?? 0} approved`],
            ["Test assets", summary?.cases ?? 0, `${summary?.bdd ?? 0} BDD · ${summary?.steps ?? 0} steps`],
            ["Your decisions", summary?.decisions ?? 0, "approvals and edits"],
          ].map(([label, value, note]) => (
            <div className="tile" key={label as string}>
              <span className="tile-label">{label}</span>
              <span className="tile-value">{value}</span>
              <span className="tile-note">{note}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Where it lives</h2>
        <Table
          columns={[
            { label: "Where", width: 180 },
            { label: "What it holds" },
            { label: "", width: 150 },
          ]}
          pageSize={20}
          rows={STORED.map(([where, holds, shared]) => ({
            id: where,
            muted: !shared,
            cells: [
              <span className="mono">{where}</span>,
              holds,
              shared ? <Pill kind="ok">goes to the repo</Pill> : <Pill kind="plain">stays local</Pill>,
            ],
          }))}
        />
        <p className="hint">{project.contextPath}</p>
      </section>

      <section className="card">
        <h2>Runs</h2>
        <Table
          columns={[
            { label: "Run", width: 90 },
            { label: "Kind", width: 110 },
            { label: "Model" },
            { label: "Judge", width: 80 },
            { label: "Produced", width: 90, align: "right" },
            { label: "Tokens", width: 110, align: "right" },
            { label: "Cost", width: 80, align: "right" },
            { label: "Status", width: 100 },
          ]}
          empty="Nothing has run yet."
          rows={[...runs].reverse().map((run) => ({
            id: run.id,
            cells: [
              <span className="mono">{run.id}</span>,
              run.kind,
              <span className="mono">
                {run.model}
                <span className="sub">{run.prompt}</span>
              </span>,
              <span className="sub">{run.judge ?? "rules"}</span>,
              run.produced,
              (run.inputTokens + run.outputTokens).toLocaleString(),
              run.cost !== null ? `$${run.cost.toFixed(2)}` : "—",
              <Pill kind={run.status === "finished" ? "ok" : run.status === "stopped" ? "warn" : "bad"}>
                {run.status}
              </Pill>,
            ],
          }))}
        />
      </section>

      {steps.length > 0 && (
        <section className="card">
          <header className="panel-head">
            <h2>Words it has learned</h2>
            <Pill kind="plain">{steps.length} steps</Pill>
          </header>
          <p className="hint">
            The step library grows with each run and is reused word for word by the next one.
          </p>
        </section>
      )}
    </div>
  );
}
