import { useEffect, useState } from "react";
import { call, describeError } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import type {
  FeasibilityReport,
  GitStatus,
  Judgement,
  Requirement,
  OpenProject,
  Suite,
  TestCase,
  ValidationReport,
} from "../types/api";

const TARGETS = ["ado", "jira-xray", "git"];

export default function ReviewPanel({
  project,
  section,
}: {
  project: OpenProject;
  section: "validation" | "gateb" | "suites" | "publish";
}) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [verified, setVerified] = useState<Judgement<boolean> | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [feasibility, setFeasibility] = useState<FeasibilityReport | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [target, setTarget] = useState("ado");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [project.path]);

  async function load() {
    try {
      const [list, suiteList, status, reqs] = await Promise.all([
        call("case_list", { projectPath: project.path }),
        call("suite_list", { projectPath: project.path }),
        call("git_status", { projectPath: project.path }),
        call("requirement_list", { projectPath: project.path }),
      ]);
      setCases(list);
      setSuites(suiteList);
      setGit(status);
      setRequirements(reqs);
      if (list.length > 0) {
        setValidation(await call("cases_validate", { projectPath: project.path }));
      }
      if (list.some((entry) => entry.state === "approved")) {
        setFeasibility(await call("feasibility_get", { projectPath: project.path }));
      }
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  const issuesOf = new Map((validation?.lines ?? []).map((line) => [line.id, line]));
  /** So a case can say it was written against wording that has since moved. */
  const versionOf = new Map(requirements.map((entry) => [entry.id, entry.version]));
  const waiting = cases.filter((entry) => entry.state === "pending");
  const approved = cases.filter((entry) => entry.state === "approved");
  const published = cases.filter((entry) => entry.publishId !== null);

  return (
    <div className="stack">
      {section === "gateb" && (
      <section className="card">
        <header className="panel-head">
          <h2>Gate B · approve what gets published</h2>
          <span className="pill pill-unknown">
            {approved.length} approved · {waiting.length} waiting
          </span>
        </header>

        {cases.length === 0 && <p className="hint">No test cases to review yet.</p>}
        {error && <p className="warn">{error}</p>}

        {waiting.length > 0 && (
          <div className="actions">
            {(() => {
              const passed = waiting.filter((entry) => issuesOf.get(entry.id)?.verdict === "Pass");
              const failed = waiting.filter((entry) => issuesOf.get(entry.id)?.verdict === "Reject");
              return (
                <>
                  {passed.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        void act(() =>
                          call("case_decide", {
                            projectPath: project.path,
                            ids: passed.map((entry) => entry.id),
                            verdict: "approved",
                          }),
                        )
                      }
                    >
                      Approve the {passed.length} that passed validation
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      if (confirm(`Approve all ${waiting.length} cases still waiting, including any with issues?`)) {
                        void act(() =>
                          call("case_decide", {
                            projectPath: project.path,
                            ids: waiting.map((entry) => entry.id),
                            verdict: "approved",
                          }),
                        );
                      }
                    }}
                  >
                    Approve all {waiting.length}
                  </button>
                  {failed.length > 0 && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        void act(() =>
                          call("case_decide", {
                            projectPath: project.path,
                            ids: failed.map((entry) => entry.id),
                            verdict: "rework",
                          }),
                        )
                      }
                    >
                      Send the {failed.length} that failed back for rework
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        )}

        <Table
          columns={[
            { label: "ID", width: 76 },
            { label: "Title" },
            { label: "Checks", width: 108 },
            { label: "Published", width: 130 },
            { label: "", width: 210 },
          ]}
          empty="No test cases to review yet."
          rows={cases.map((entry) => {
            const line = issuesOf.get(entry.id);
            return {
              id: entry.id,
              muted: entry.state === "rejected",
              cells: [
                <span className="mono">{entry.id}</span>,
                <>
                  {entry.title}
                  {line && line.issues.length > 0 ? <span className="sub">{line.issues.join("; ")}</span> : null}
                  {entry.decidedAt ? (
                    <span className="sub">decided {new Date(entry.decidedAt).toLocaleString()}</span>
                  ) : null}
                  {versionOf.get(entry.reqId) !== undefined &&
                  entry.reqVersion < (versionOf.get(entry.reqId) ?? 1) ? (
                    <span className="sub warn">
                      written against {entry.reqId} v{entry.reqVersion}, which is now v
                      {versionOf.get(entry.reqId)}
                    </span>
                  ) : null}
                </>,
                line ? (
                  <Pill kind={line.verdict === "Pass" ? "ok" : line.verdict === "Rework" ? "warn" : "bad"}>
                    {line.verdict} {line.score}
                  </Pill>
                ) : (
                  <Pill kind="plain">not checked</Pill>
                ),
                entry.publishId ? <span className="mono">{entry.publishId}</span> : <span className="sub">—</span>,
                entry.state === "pending" ? (
                  <span className="inline-actions">
                    <button
                      type="button"
                      onClick={() =>
                        void act(() =>
                          call("case_decide", { projectPath: project.path, ids: [entry.id], verdict: "approved" }),
                        )
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        void act(() =>
                          call("case_decide", { projectPath: project.path, ids: [entry.id], verdict: "rework" }),
                        )
                      }
                    >
                      Rework
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        void act(() =>
                          call("case_decide", { projectPath: project.path, ids: [entry.id], verdict: "rejected" }),
                        )
                      }
                    >
                      Reject
                    </button>
                  </span>
                ) : (
                  <span className="inline-actions">
                    <Pill kind={entry.state === "approved" ? "ok" : entry.state === "rework" ? "warn" : "bad"}>
                      {entry.state}
                    </Pill>
                  </span>
                ),
              ],
            };
          })}
        />
      </section>
      )}

      {section === "validation" && (
        <section className="card">
          <header className="panel-head">
            <h2>Validation</h2>
            {validation && (
              <Pill kind="plain">
                {validation.pass} pass · {validation.rework} rework · {validation.reject} reject
              </Pill>
            )}
          </header>
          <p className="hint">
            Five checks, rules only: a missing expected result, a missing precondition, fewer than
            two steps, no link to a scenario, a duplicate title. Each costs a fifth of the score.
          </p>
          <Table
            columns={[
              { label: "ID", width: 76 },
              { label: "Title" },
              { label: "Issues" },
              { label: "Score", width: 70, align: "right" },
              { label: "Verdict", width: 90 },
            ]}
            empty="Nothing to check yet."
            rows={(validation?.lines ?? []).map((line) => ({
              id: line.id,
              cells: [
                <span className="mono">{line.id}</span>,
                line.title,
                line.issues.length > 0 ? line.issues.join("; ") : <span className="sub">none</span>,
                line.score,
                <Pill kind={line.verdict === "Pass" ? "ok" : line.verdict === "Rework" ? "warn" : "bad"}>
                  {line.verdict}
                </Pill>,
              ],
            }))}
          />

          <header className="panel-head">
            <h2>Does each case test its scenario?</h2>
            {verified && (
              <Pill kind={verified.answers.some((entry) => !entry.answer) ? "warn" : "ok"}>
                {verified.answers.filter((entry) => !entry.answer).length} off target
              </Pill>
            )}
          </header>
          <p className="hint">
            The five checks above count whether the fields are filled in. A case can pass all five
            and still test the wrong thing — nothing but a judge can tell you that, so this is the
            one question that needs Jev switched on. It sits beside the score rather than inside
            it, because the score is arithmetic we reproduce exactly.
          </p>
          <div className="actions">
            <button
              type="button"
              className="ghost"
              disabled={verifying}
              onClick={() => {
                setVerifying(true);
                setVerifyError(null);
                void call("cases_verify", { projectPath: project.path })
                  .then(setVerified)
                  .catch((cause: unknown) => setVerifyError(describeError(cause)))
                  .finally(() => setVerifying(false));
              }}
            >
              {verifying ? "Reading each case…" : "Check them against their scenarios"}
            </button>
            {verified && (
              <span className="hint">
                {verified.answers.length} checked by {verified.model || "the judge"} ·{" "}
                {(verified.inputTokens + verified.outputTokens).toLocaleString()} tokens
              </span>
            )}
          </div>
          {verifyError && <p className="warn">{verifyError}</p>}

          {verified && (
            <Table
              columns={[
                { label: "ID", width: 76 },
                { label: "What the judge saw" },
                { label: "Sure", width: 70, align: "right" },
              ]}
              empty="Every case tests what it says it does."
              rows={verified.answers
                .filter((entry) => !entry.answer)
                .sort((left, right) => right.confidence - left.confidence)
                .map((entry) => ({
                  id: entry.id,
                  cells: [
                    <span className="mono">{entry.id}</span>,
                    entry.why,
                    `${Math.round(entry.confidence * 100)}%`,
                  ],
                }))}
            />
          )}
        </section>
      )}

      {section === "suites" && approved.length > 0 && (
        <section className="card">
          <h2>Suites</h2>
          <p className="hint">
            Only approved cases can be assigned. A case can be in more than one suite.
          </p>
          <div className="rows">
            {suites.map((suite) => (
              <div className="row" key={suite.id}>
                <span className="row-main">
                  {suite.name} · {suite.cases.length}
                </span>
                <span className="row-sub">{suite.purpose}</span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    void act(() =>
                      call("suite_fill_from_risk", {
                        projectPath: project.path,
                        suiteId: suite.id,
                        band: suite.id === "release" ? "P1" : suite.id === "regression" ? "P2" : "P3",
                      }),
                    )
                  }
                >
                  Fill from risk
                </button>
              </div>
            ))}
          </div>

          <Table
            columns={[
              { label: "ID", width: 76 },
              { label: "Title" },
              ...suites.map((suite) => ({ label: suite.id, width: 96 })),
            ]}
            rows={approved.map((entry) => ({
              id: entry.id,
              cells: [
                <span className="mono">{entry.id}</span>,
                entry.title,
                ...suites.map((suite) => (
                  <button
                    type="button"
                    className={suite.cases.includes(entry.id) ? "" : "ghost"}
                    onClick={() =>
                      void act(() =>
                        call("suite_toggle", {
                          projectPath: project.path,
                          suiteId: suite.id,
                          caseId: entry.id,
                        }),
                      )
                    }
                  >
                    {suite.cases.includes(entry.id) ? "in" : "add"}
                  </button>
                )),
              ],
            }))}
          />
        </section>
      )}

      {section === "publish" && feasibility && (
        <section className="card">
          <header className="panel-head">
            <h2>Automation</h2>
            <span className="pill pill-unknown">
              {feasibility.automatable} automatable · {feasibility.partial} partial ·{" "}
              {feasibility.manual} manual
            </span>
          </header>
          <Table
            columns={[
              { label: "ID", width: 76 },
              { label: "Title" },
              { label: "Tool", width: 150 },
              { label: "Value", width: 70 },
              { label: "Automation", width: 110 },
            ]}
            rows={feasibility.lines.map((line) => ({
              id: line.id,
              cells: [
                <span className="mono">{line.id}</span>,
                <>
                  {line.title}
                  <span className="sub">{line.why}</span>
                </>,
                line.tool,
                line.value,
                <Pill
                  kind={line.automation === "Automatable" ? "ok" : line.automation === "Partial" ? "warn" : "plain"}
                >
                  {line.automation}
                </Pill>,
              ],
            }))}
          />
        </section>
      )}

      {section === "publish" && approved.length > 0 && (
        <section className="card">
          <header className="panel-head">
            <h2>Publish</h2>
            {published.length > 0 && (
              <span className="pill pill-valid">{published.length} published</span>
            )}
          </header>
          <p className="warn">
            This writes receipts and an export file. It does not call an ALM API yet.
          </p>
          <div className="actions">
            <select value={target} onChange={(change) => setTarget(change.target.value)}>
              {TARGETS.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                void act(async () => {
                  const result = await call("publish_run", { projectPath: project.path, target });
                  setNote(`${result.published} cases published to ${result.target} · ${result.file}`);
                })
              }
            >
              Publish the approved cases
            </button>
          </div>
          {note && <p className="hint">{note}</p>}
        </section>
      )}

      {section === "publish" && (
      <section className="card">
        <h2>Push to the repository</h2>
        {!git?.isRepo ? (
          <p className="hint">
            This project folder is not a git repository, so there is nothing to push to.
          </p>
        ) : (
          <>
            <p className="hint">
              Branch {git.branch ?? "unknown"} · {git.changed} changed files, {git.contextChanged} of
              them in the project context{git.hasRemote ? "" : " · no remote is configured"}
            </p>
            <div className="actions">
              <button
                type="button"
                disabled={git.changed === 0}
                onClick={() =>
                  void act(async () => {
                    const result = await call("git_commit", {
                      projectPath: project.path,
                      message: "tests and project context from TestInference",
                      includeContext: true,
                      push: false,
                    });
                    setNote(result.detail);
                  })
                }
              >
                Commit tests and context
              </button>
              <button
                type="button"
                className="ghost"
                disabled={git.changed === 0}
                onClick={() =>
                  void act(async () => {
                    const result = await call("git_commit", {
                      projectPath: project.path,
                      message: "tests from TestInference",
                      includeContext: false,
                      push: false,
                    });
                    setNote(result.detail);
                  })
                }
              >
                Commit tests only
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!git.hasRemote}
                onClick={() =>
                  void act(async () => {
                    const result = await call("git_commit", {
                      projectPath: project.path,
                      message: "tests and project context from TestInference",
                      includeContext: true,
                      push: true,
                    });
                    setNote(result.detail);
                  })
                }
              >
                Commit and push
              </button>
            </div>
            <p className="hint">
              Nothing is pushed unless you press push. Your own git setup is used; no credentials are
              stored here.
            </p>
          </>
        )}
      </section>
      )}
    </div>
  );
}
