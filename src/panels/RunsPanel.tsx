import { useEffect, useState } from "react";
import { call, describeError } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import { useDetail } from "../ui/detail";
import type { Attempt, CaseResult, OpenProject, TestPlan } from "../types/api";

/**
 * Running the tests, and what happened when they did.
 *
 * It replays the same plan the written file was made from, so watching it
 * here and running it in CI cannot disagree. What this adds is the step
 * that failed, the message, and a picture of the page at that moment —
 * the three things anyone wants first.
 */
export default function RunsPanel({ project }: { project: OpenProject }) {
  const [plans, setPlans] = useState<TestPlan[]>([]);
  const [history, setHistory] = useState<Attempt[]>([]);
  const [latest, setLatest] = useState<Attempt | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [watch, setWatch] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [project.path]);

  async function load() {
    try {
      const [written, past] = await Promise.all([
        call("plan_list", { projectPath: project.path }),
        call("tests_history", { projectPath: project.path }),
      ]);
      setPlans(written);
      setHistory(past);
      setLatest(past.at(-1) ?? null);
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  async function go(only: string | null) {
    setRunning(true);
    setError(null);
    try {
      setLatest(await call("tests_run", { projectPath: project.path, only, watch }));
      await load();
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setRunning(false);
    }
  }

  const chosen = latest?.cases.find((entry) => entry.id === selected) ?? null;

  /** Whether this test did the same last time. */
  function changed(result: CaseResult): string | null {
    const before = history.at(-2)?.cases.find((entry) => entry.id === result.id);
    if (!before || before.state === result.state) return null;
    return before.state === "passed" && result.state === "failed"
      ? "was passing"
      : result.state === "passed" && before.state === "failed"
        ? "was failing"
        : null;
  }

  useDetail(
    chosen ? (
      <>
        <header className="panel-head">
          <h2>{chosen.id}</h2>
          <Pill kind={chosen.state === "passed" ? "ok" : chosen.state === "failed" ? "bad" : "warn"}>
            {chosen.state}
          </Pill>
        </header>
        <p className="lede">{chosen.title}</p>
        {chosen.detail && <p className="warn">{chosen.detail}</p>}

        <span className="aside-label">Step by step</span>
        <div className="rows">
          {chosen.steps.map((step, at) => (
            <div className="row" key={at}>
              <span className="row-main">{step.from}</span>
              {step.detail && <span className="row-sub">{step.detail}</span>}
              <Pill
                kind={step.state === "passed" ? "ok" : step.state === "failed" ? "bad" : "plain"}
              >
                {step.state === "passed" ? `${step.ms} ms` : step.state}
              </Pill>
            </div>
          ))}
        </div>

        {chosen.endedAt && (
          <>
            <span className="aside-label">Ended on</span>
            <code className="path">{chosen.endedAt}</code>
          </>
        )}

        {chosen.shot && (
          <>
            <span className="aside-label">The page when it failed</span>
            <code className="path">{chosen.shot}</code>
            <p className="hint">
              Kept outside the project, because a screenshot is large and binary and nobody wants
              one in a commit.
            </p>
          </>
        )}
      </>
    ) : null,
    [selected, latest?.id],
    () => setSelected(null),
  );

  return (
    <div className="stack">
      <section className="card">
        <header className="panel-head">
          <h2>Runs</h2>
          {latest && (
            <Pill kind={latest.failed > 0 ? "bad" : latest.passed > 0 ? "ok" : "warn"}>
              {latest.passed} passed · {latest.failed} failed
            </Pill>
          )}
        </header>

        <p className="hint">
          These are the tests as written, replayed step by step. A test that was never finished
          is not run and never counts as passed — it stays in the list as unfinished, which is
          the truth about it.
        </p>

        <div className="actions">
          <button type="button" disabled={running || plans.length === 0} onClick={() => void go(null)}>
            {running ? "Running…" : `Run all ${plans.length}`}
          </button>
          <label className="row-main">
            <input type="checkbox" checked={watch} onChange={(c) => setWatch(c.target.checked)} />{" "}
            Watch it happen
          </label>
          <span className="hint">
            Watching opens a real browser window. Worth doing once: a test nobody has seen run is
            not yet evidence of anything.
          </span>
        </div>

        {plans.length === 0 && (
          <p className="warn">Nothing written yet. Build → Tests · code first.</p>
        )}
        {error && <p className="warn">{error}</p>}

        {history.length > 1 && (
          <p className="hint">
            {history.length} runs kept. Last time: {history.at(-2)?.passed} passed,{" "}
            {history.at(-2)?.failed} failed.
          </p>
        )}
      </section>

      {latest && (
        <Table
          columns={[
            { label: "Case", width: 90 },
            { label: "Title" },
            { label: "Took", width: 80, align: "right" },
            { label: "", width: 130 },
          ]}
          empty="Nothing has run yet."
          rows={latest.cases.map((result) => {
            const moved = changed(result);
            return {
              id: result.id,
              selected: result.id === selected,
              muted: result.state === "unfinished",
              onSelect: () => setSelected(result.id),
              cells: [
                <span className="mono">{result.id}</span>,
                <>
                  {result.title}
                  {result.detail && <span className="sub">{result.detail}</span>}
                  {moved && <span className="sub warn">{moved}</span>}
                </>,
                result.state === "unfinished" ? "—" : `${(result.ms / 1000).toFixed(1)}s`,
                <Pill
                  kind={
                    result.state === "passed" ? "ok" : result.state === "failed" ? "bad" : "warn"
                  }
                >
                  {result.state}
                </Pill>,
              ],
            };
          })}
        />
      )}
    </div>
  );
}
