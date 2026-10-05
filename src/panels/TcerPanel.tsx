import { useEffect, useState } from "react";
import { call, describeError } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import type { OpenProject, Run, TcerEstimate, TcerRow } from "../types/api";

export default function TcerPanel({ project }: { project: OpenProject }) {
  const [rows, setRows] = useState<TcerRow[]>([]);
  const [estimate, setEstimate] = useState<TcerEstimate | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [project.path]);

  async function load() {
    try {
      const [list, runs] = await Promise.all([
        call("tcer_list", { projectPath: project.path }),
        call("run_list", { projectPath: project.path }),
      ]);
      setRows(list);
      setRun(runs.filter((entry) => entry.kind === "tcer").at(-1) ?? null);
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  const active = rows.filter((row) => !row.removed);
  const average =
    active.length === 0
      ? 0
      : Math.round(active.reduce((total, row) => total + row.score, 0) / active.length);
  const counts = {
    pass: active.filter((row) => row.verdict === "Pass").length,
    rework: active.filter((row) => row.verdict === "Rework").length,
    reject: active.filter((row) => row.verdict === "Reject").length,
  };

  return (
    <div className="stack">
      <section className="card">
        <header className="panel-head">
          <h2>TCER</h2>
          {rows.length > 0 && (
            <span className="pill pill-unknown">
              {active.length} active · average {average}%
            </span>
          )}
        </header>

        {rows.length === 0 && (
          <p className="hint">Nothing here yet. Approve some scenarios at Gate A, then complete them.</p>
        )}

        <div className="actions">
          <button
            type="button"
            disabled={running}
            onClick={() =>
              void call("tcer_estimate", { projectPath: project.path })
                .then(setEstimate)
                .catch((cause: unknown) => setError(describeError(cause)))
            }
          >
            {rows.length > 0 ? "Complete again" : "Complete the approved scenarios"}
          </button>
        </div>

        {error && <p className="warn">{error}</p>}

        {estimate && !running && (
          <div className="estimate">
            <div className="facts">
              <div>
                <dt>Approved</dt>
                <dd>{estimate.approved}</dd>
              </div>
              <div>
                <dt>Already complete</dt>
                <dd>{estimate.complete}</dd>
              </div>
              <div>
                <dt>To send</dt>
                <dd>{estimate.toComplete}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{estimate.toComplete === 0 ? "none needed" : estimate.model ?? "none assigned"}</dd>
              </div>
            </div>
            <p className={estimate.overBudget ? "warn" : "hint"}>{estimate.note}</p>
            <div className="actions">
              <button
                type="button"
                disabled={estimate.overBudget || estimate.approved === 0}
                onClick={() => {
                  setRunning(true);
                  setEstimate(null);
                  void call("tcer_run", { projectPath: project.path })
                    .catch((cause: unknown) => setError(describeError(cause)))
                    .finally(() => {
                      setRunning(false);
                      void load();
                    });
                }}
              >
                Go
              </button>
              <button type="button" className="ghost" onClick={() => setEstimate(null)}>
                Not now
              </button>
            </div>
          </div>
        )}

        {running && <p className="hint">Completing and scoring…</p>}

        {run && !running && (
          <p className="hint">
            {run.id} · {run.status} · {run.note ?? ""}
            {run.cost !== null ? ` · $${run.cost.toFixed(2)}` : ""}
          </p>
        )}

        {rows.length > 0 && (
          <p className="hint">
            {counts.pass} pass · {counts.rework} rework · {counts.reject} reject. The score is four
            presence checks worth 25% each — a title and a result, an action and a result, a result
            that says something, and a link to a requirement.
          </p>
        )}
      </section>

      {rows.length > 0 && (
        <section className="card">
          <Table
            columns={[
              { label: "TC", width: 76 },
              { label: "Title" },
              { label: "Expected result", width: 250 },
              { label: "From", width: 120 },
              { label: "Score", width: 96, align: "right" },
              { label: "", width: 92 },
            ]}
            rows={rows.map((row) => ({
              id: row.tcId,
              muted: row.removed,
              cells: [
                <span className="mono">{row.tcId}</span>,
                <>
                  {row.title}
                  {row.comment ? <span className="sub">note: {row.comment}</span> : null}
                  {row.reasons.length > 0 ? <span className="sub">{row.reasons.join("; ")}</span> : null}
                </>,
                row.expected || <span className="sub">no expected result</span>,
                <span className="mono">
                  {row.id} · {row.reqId}
                  <span className="sub">{row.madeBy ? "completed by a model" : "already complete"}</span>
                </span>,
                row.removed ? (
                  <Pill kind="plain">removed</Pill>
                ) : (
                  <Pill kind={row.verdict === "Pass" ? "ok" : row.verdict === "Rework" ? "warn" : "bad"}>
                    {row.verdict} {row.score}%
                  </Pill>
                ),
                <span className="inline-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      void call("tcer_amend", {
                        projectPath: project.path,
                        tcId: row.tcId,
                        removed: !row.removed,
                      })
                        .then(setRows)
                        .catch((cause: unknown) => setError(describeError(cause)))
                    }
                  >
                    {row.removed ? "Restore" : "Remove"}
                  </button>
                </span>,
              ],
            }))}
          />
        </section>
      )}
    </div>
  );
}
