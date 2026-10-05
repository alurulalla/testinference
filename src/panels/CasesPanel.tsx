import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { call, describeError } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import { useDetail } from "../ui/detail";
import {
  CASE_FIELDS,
  type CaseLink,
  type CasesEstimate,
  type Derived,
  type Judgement,
  type Imported,
  type ImportPreview,
  type OpenProject,
  type Run,
  type TestCase,
  type ValidationReport,
} from "../types/api";

/** Nothing can be made of a case without these two. */
const REQUIRED: string[] = ["title", "steps"];

export default function CasesPanel({ project }: { project: OpenProject }) {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [estimate, setEstimate] = useState<CasesEstimate | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [imported, setImported] = useState<Imported | null>(null);
  const [links, setLinks] = useState<Judgement<CaseLink | null> | null>(null);
  const [derived, setDerived] = useState<Derived | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [project.path]);

  async function load() {
    try {
      const [list, runs] = await Promise.all([
        call("case_list", { projectPath: project.path }),
        call("run_list", { projectPath: project.path }),
      ]);
      setCases(list);
      setRun(runs.filter((entry) => entry.kind === "cases").at(-1) ?? null);
      setValidation(
        list.length > 0 ? await call("cases_validate", { projectPath: project.path }) : null,
      );
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  const issuesOf = new Map((validation?.lines ?? []).map((line) => [line.id, line]));
  const chosen = cases.find((entry) => entry.id === selected) ?? null;

  useDetail(
    
          chosen ? (
            <>
              <header className="panel-head">
                <h2>{chosen.id}</h2>
                <Pill kind="plain">{chosen.platform || "no platform"}</Pill>
              </header>
              <p className="lede">{chosen.title}</p>
              {chosen.description && <p className="hint">{chosen.description}</p>}

              <span className="aside-label">Before</span>
              <span className="aside-value">{chosen.precondition || "— not given"}</span>

              <span className="aside-label">Test data</span>
              <span className="aside-value">{chosen.testData || "— none"}</span>

              <span className="aside-label">Steps</span>
              <pre className="path">{chosen.steps || "— none"}</pre>

              <span className="aside-label">Expected results</span>
              <pre className="path">{chosen.expected || "— none"}</pre>

              <span className="aside-label">Traces to</span>
              <span className="aside-value">
                {chosen.importedFrom
                  ? `imported from ${chosen.importedFrom}`
                  : `written by ${chosen.madeBy.model}`}
                {chosen.scenarioId || chosen.reqId
                  ? ` · ${[chosen.scenarioId, chosen.reqId].filter(Boolean).join(" · ")}`
                  : " · not linked to a requirement"}
              </span>
            </>
          ) : null,
    [selected, cases.length],
  () => setSelected(null),
);

  /** Picks a spreadsheet and reads it, without importing anything yet. */
  async function choose() {
    setError(null);
    setImported(null);

    const chosen = await open({
      multiple: false,
      filters: [{ name: "Spreadsheets", extensions: ["csv", "tsv", "txt"] }],
    });
    if (typeof chosen !== "string") return;

    setRunning(true);
    try {
      setSource(chosen);
      setPreview(await call("cases_import_preview", { projectPath: project.path, sourcePath: chosen }));
    } catch (cause: unknown) {
      setError(describeError(cause));
      setPreview(null);
    } finally {
      setRunning(false);
    }
  }

  async function bringIn() {
    if (!preview || !source) return;
    setRunning(true);
    setError(null);
    try {
      const result = await call("cases_import", {
        projectPath: project.path,
        sourcePath: source,
        mapping: preview.mapping,
      });
      setImported(result);
      setPreview(null);
      await load();
      // Imported cases have not been checked yet, and the first thing
      // anyone will want to know is what is wrong with them.
      setValidation(await call("cases_validate", { projectPath: project.path }));
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setRunning(false);
    }
  }

  /** Builds the scenario and TCER row each linked case implies. */
  async function deriveSpine() {
    setRunning(true);
    setError(null);
    try {
      setDerived(await call("cases_derive_spine", { projectPath: project.path }));
      await load();
      setValidation(await call("cases_validate", { projectPath: project.path }));
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setRunning(false);
    }
  }

  /** Asks which requirement each untraced case tests. Writes nothing. */
  async function proposeLinks() {
    setRunning(true);
    setError(null);
    try {
      const proposed = await call("cases_link_propose", { projectPath: project.path });
      setLinks(proposed);
      // The confident ones are ticked to begin with; the rest are not, so
      // accepting everything in one click is never the default.
      setAccepted(
        new Set(
          proposed.answers
            .filter((entry) => entry.answer !== null && entry.confidence >= 0.7)
            .map((entry) => entry.id),
        ),
      );
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setRunning(false);
    }
  }

  async function applyLinks() {
    if (!links) return;
    setRunning(true);
    setError(null);
    try {
      const chosen: Array<[string, string]> = links.answers
        .filter((entry) => entry.answer !== null && accepted.has(entry.id))
        .map((entry) => [entry.id, entry.answer!.reqId]);
      await call("cases_link_apply", { projectPath: project.path, links: chosen });
      setLinks(null);
      setAccepted(new Set());
      await load();
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setRunning(false);
    }
  }

  const untraced = cases.filter((entry) => !entry.reqId.trim());
  /** Linked to a requirement, but with no scenario or TCER row behind it. */
  const spineless = cases.filter((entry) => entry.reqId.trim() && !entry.scenarioId.trim());

  /** Pointing a field at a column, or away from one. */
  function point(fieldName: string, column: number | null) {
    if (!preview) return;
    const mapping = { ...preview.mapping };
    if (column === null) delete mapping[fieldName];
    else {
      // A column can only hold one field, so claiming it frees it.
      for (const [other, index] of Object.entries(mapping)) {
        if (index === column && other !== fieldName) delete mapping[other];
      }
      mapping[fieldName] = column;
    }
    setPreview({ ...preview, mapping, missing: REQUIRED.filter((name) => mapping[name] === undefined) });
  }

  return (
    <div className="stack">
      <section className="card">
        <header className="panel-head">
          <h2>Test cases</h2>
          {validation && (
            <span className="pill pill-unknown">
              {validation.pass} pass · {validation.rework} rework · {validation.reject} reject
            </span>
          )}
        </header>

        {cases.length === 0 && (
          <p className="hint">
            Nothing written yet. Complete and score some rows first — or bring in the cases you
            already have.
          </p>
        )}

        <div className="actions">
          <button
            type="button"
            disabled={running}
            onClick={() =>
              void call("cases_estimate", { projectPath: project.path })
                .then(setEstimate)
                .catch((cause: unknown) => setError(describeError(cause)))
            }
          >
            {cases.length > 0 ? "Write again" : "Write the test cases"}
          </button>
          <button type="button" className="ghost" disabled={running} onClick={() => void choose()}>
            Import from a spreadsheet
          </button>

          {untraced.length > 0 && (
            <button
              type="button"
              className="ghost"
              disabled={running}
              onClick={() => void proposeLinks()}
            >
              {running ? "Reading…" : `Link ${untraced.length} to requirements`}
            </button>
          )}

          {spineless.length > 0 && (
            <button
              type="button"
              className="ghost"
              disabled={running}
              onClick={() => void deriveSpine()}
            >
              {running ? "Deriving…" : `Derive ${spineless.length} scenarios and rows`}
            </button>
          )}

          {cases.length > 0 && (
            <button
              type="button"
              className="ghost"
              onClick={() =>
                void call("cases_validate", { projectPath: project.path })
                  .then(setValidation)
                  .catch((cause: unknown) => setError(describeError(cause)))
              }
            >
              Check them again
            </button>
          )}
        </div>

        {imported && (
          <div className="estimate">
            <p className="hint">
              {imported.added} cases imported
              {imported.skipped > 0 ? `, ${imported.skipped} rows skipped` : ""}. {imported.note}
            </p>
            {imported.renamed.length > 0 && (
              <p className="hint">
                {imported.renamed.length} kept a different identifier: {imported.renamed[0]}
                {imported.renamed.length > 1 ? `, and ${imported.renamed.length - 1} more` : ""}.
              </p>
            )}
          </div>
        )}

        {derived && (
          <div className="estimate">
            <p className="hint">
              {derived.scenarios} scenarios and {derived.rows} TCER rows derived
              {derived.judged > 0 ? `, ${derived.judged} classed by the judge` : ""}. {derived.note}
            </p>
          </div>
        )}

        {links && (
          <div className="estimate">
            <header className="panel-head">
              <h3>Which requirement does each case test?</h3>
              <Pill kind="plain">
                {links.answers.filter((entry) => entry.answer !== null).length} of{" "}
                {links.answers.length} matched
              </Pill>
            </header>
            <p className="hint">
              Nothing is written until you apply it. A wrong link is worse than none, because it
              makes a requirement look tested when it is not — so only the confident ones are
              ticked, and you can untick any of them.
            </p>

            <Table
              columns={[
                { label: "Use", width: 50 },
                { label: "Case", width: 90 },
                { label: "Requirement", width: 100 },
                { label: "Why" },
                { label: "Sure", width: 64, align: "right" },
              ]}
              empty="Nothing to link."
              rows={links.answers.map((entry) => ({
                id: entry.id,
                muted: entry.answer === null,
                cells: [
                  entry.answer === null ? (
                    <span className="sub">—</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={accepted.has(entry.id)}
                      onChange={(change) => {
                        const next = new Set(accepted);
                        if (change.target.checked) next.add(entry.id);
                        else next.delete(entry.id);
                        setAccepted(next);
                      }}
                    />
                  ),
                  <span className="mono">{entry.id}</span>,
                  entry.answer === null ? (
                    <span className="sub">none</span>
                  ) : (
                    <span className="mono">{entry.answer.reqId}</span>
                  ),
                  entry.why,
                  `${Math.round(entry.confidence * 100)}%`,
                ],
              }))}
            />

            <div className="actions">
              <button type="button" disabled={running || accepted.size === 0} onClick={() => void applyLinks()}>
                Link the {accepted.size} ticked
              </button>
              <button type="button" className="ghost" onClick={() => setLinks(null)}>
                Cancel
              </button>
              <span className="hint">
                Answered by {links.model || "wording alone"}
                {links.inputTokens > 0
                  ? ` · ${(links.inputTokens + links.outputTokens).toLocaleString()} tokens`
                  : ""}
              </span>
            </div>
          </div>
        )}

        {preview && (
          <div className="estimate">
            <header className="panel-head">
              <h3>{preview.total} rows · which column is which</h3>
              <Pill kind={preview.by === "jev" ? "ok" : "plain"}>
                {preview.by === "jev" ? "named and judged" : "matched by name"}
              </Pill>
            </header>
            <p className={preview.missing.length > 0 ? "warn" : "hint"}>{preview.note}</p>

            <div className="rows">
              {CASE_FIELDS.map((fieldName) => {
                const column = preview.mapping[fieldName];
                const required = REQUIRED.includes(fieldName);
                return (
                  <div className="row" key={fieldName}>
                    <span className="row-main">
                      {fieldName}
                      {required ? " ·  needed" : ""}
                    </span>
                    <span className="row-sub">
                      {column === undefined
                        ? "not in this file"
                        : (preview.why[String(column)] ?? `from "${preview.columns[column]}"`)}
                    </span>
                    <select
                      value={column === undefined ? "" : String(column)}
                      onChange={(change) =>
                        point(fieldName, change.target.value === "" ? null : Number(change.target.value))
                      }
                    >
                      <option value="">not in this file</option>
                      {preview.columns.map((heading, index) => (
                        <option value={index} key={index}>
                          {heading}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

            <div className="tablewrap">
              <table className="peek">
                <thead>
                  <tr>
                    {preview.columns.map((heading, index) => (
                      <th key={index}>
                        {heading}
                        <span className="sub">
                          {Object.entries(preview.mapping).find(([, at]) => at === index)?.[0] ?? "—"}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, at) => (
                    <tr key={at}>
                      {preview.columns.map((_heading, index) => (
                        <td key={index}>{(row[index] ?? "").slice(0, 90)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="actions">
              <button
                type="button"
                disabled={running || preview.missing.length > 0}
                onClick={() => void bringIn()}
              >
                {running ? "Importing…" : `Import ${preview.total} cases`}
              </button>
              <button type="button" className="ghost" onClick={() => setPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && <p className="warn">{error}</p>}

        {estimate && !running && (
          <div className="estimate">
            <div className="facts">
              <div>
                <dt>Rows to write up</dt>
                <dd>{estimate.rows}</dd>
              </div>
              <div>
                <dt>Left out</dt>
                <dd>
                  {estimate.skippedRejected} rejected · {estimate.skippedRemoved} removed
                </dd>
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
                disabled={estimate.model === null || estimate.overBudget || estimate.rows === 0}
                onClick={() => {
                  setRunning(true);
                  setEstimate(null);
                  void call("cases_run", { projectPath: project.path })
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

        {running && <p className="hint">Writing…</p>}

        {run && !running && (
          <p className="hint">
            {run.id} · {run.status} · {run.note ?? ""}
            {run.cost !== null ? ` · $${run.cost.toFixed(2)}` : ""}
          </p>
        )}
      </section>

        <Table
          columns={[
            { label: "ID", width: 76 },
            { label: "Title" },
            { label: "From", width: 120 },
            { label: "Type", width: 96 },
            { label: "Automation", width: 100 },
            { label: "Checks", width: 108 },
          ]}
          empty="Nothing written yet."
          rows={cases.map((entry) => {
            const line = issuesOf.get(entry.id);
            return {
              id: entry.id,
              selected: entry.id === selected,
              onSelect: () => setSelected(entry.id),
              cells: [
                <span className="mono">{entry.id}</span>,
                <>
                  {entry.title}
                  {line && line.issues.length > 0 ? <span className="sub">{line.issues.join("; ")}</span> : null}
                </>,
                <span className="mono">
                  {entry.scenarioId || "uploaded"}
                  <span className="sub">{entry.reqId}</span>
                </span>,
                <>
                  {entry.caseType}
                  <span className="sub">{entry.priority}</span>
                </>,
                entry.autoFeasibility || <span className="sub">unknown</span>,
                line ? (
                  <Pill kind={line.verdict === "Pass" ? "ok" : line.verdict === "Rework" ? "warn" : "bad"}>
                    {line.verdict} {line.score}
                  </Pill>
                ) : (
                  <Pill kind="plain">not checked</Pill>
                ),
              ],
            };
          })}
        />
    </div>
  );
}
