import { useEffect, useState } from "react";
import { call, describeError } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import type { CodeEstimate, Generated, OpenProject } from "../types/api";

/**
 * Approved test cases, written out as something a browser can run.
 *
 * The map is what makes this more than a guess: each step is matched to a
 * control that was observed to exist, not to a selector a model imagined.
 * Where no control fits, no line is written and the test is marked
 * unfinished — a green tick nobody earned is worse than a visible gap.
 */
export default function CodePanel({ project }: { project: OpenProject }) {
  const [estimate, setEstimate] = useState<CodeEstimate | null>(null);
  const [written, setWritten] = useState<Generated | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call("code_estimate", { projectPath: project.path })
      .then(setEstimate)
      .catch((cause: unknown) => setError(describeError(cause)));
  }, [project.path]);

  const ready = (estimate?.cases ?? 0) > 0 && (estimate?.pages ?? 0) > 0 && estimate?.model;

  return (
    <div className="stack">
      <section className="card">
        <header className="panel-head">
          <h2>Tests · code</h2>
          {written && (
            <Pill kind={written.unfinished === 0 ? "ok" : "warn"}>
              {written.runnable} runnable
            </Pill>
          )}
        </header>

        <p className="hint">
          Every step is matched to a control the explorer actually found. Nothing here invents a
          selector from the words of a test case, which is why the code points at things that
          exist. Where nothing fits, the line is left out and the test is marked unfinished, so it
          reports as not done rather than passing while checking nothing.
        </p>

        {estimate && (
          <div className="facts">
            <div>
              <dt>Approved cases</dt>
              <dd>{estimate.cases}</dd>
            </div>
            <div>
              <dt>Pages explored</dt>
              <dd>{estimate.pages}</dd>
            </div>
            <div>
              <dt>Controls to aim at</dt>
              <dd>{estimate.controls}</dd>
            </div>
          </div>
        )}
        {estimate && <p className={ready ? "hint" : "warn"}>{estimate.note}</p>}
        {error && <p className="warn">{error}</p>}

        <div className="actions">
          <button
            type="button"
            disabled={running || !ready}
            onClick={() => {
              setRunning(true);
              setError(null);
              void call("code_run", { projectPath: project.path })
                .then(setWritten)
                .catch((cause: unknown) => setError(describeError(cause)))
                .finally(() => setRunning(false));
            }}
          >
            {running ? "Writing…" : written ? "Write them again" : "Write the tests"}
          </button>
        </div>

        {written && (
          <div className="estimate">
            <p className="hint">{written.note}</p>
            <code className="path">{written.path}</code>
          </div>
        )}
      </section>

      {written && written.gaps.length > 0 && (
        <section className="card">
          <header className="panel-head">
            <h2>What could not be written</h2>
            <Pill kind="warn">{written.gaps.length}</Pill>
          </header>
          <p className="hint">
            These are in the file and marked so they do not pass. Most are one of two things: a
            step that needs something outside a browser, or a control the explorer never saw —
            which usually means the page it is on has not been explored yet.
          </p>
          <Table
            columns={[
              { label: "Case", width: 90 },
              { label: "Title" },
              { label: "What is missing" },
            ]}
            empty="Everything could be written."
            rows={written.gaps.map((gap) => ({
              id: gap.id,
              cells: [
                <span className="mono">{gap.id}</span>,
                gap.title,
                <>
                  {gap.checks === 0 && (
                    <span className="sub">nothing in the expected result could be checked</span>
                  )}
                  {gap.lines
                    .filter((line) => line.problem)
                    .slice(0, 3)
                    .map((line, at) => (
                      <span className="sub" key={at}>
                        {line.from.slice(0, 48)} — {line.problem}
                      </span>
                    ))}
                </>,
              ],
            }))}
          />
        </section>
      )}
    </div>
  );
}
