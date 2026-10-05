import { useEffect, useState } from "react";
import { call, describeError } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import type { CoverageReport, OpenProject } from "../types/api";

export default function CoveragePanel({
  project,
  section,
}: {
  project: OpenProject;
  section: "coverage" | "risk";
}) {
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call("coverage_get", { projectPath: project.path })
      .then(setReport)
      .catch((cause: unknown) => setError(describeError(cause)));
  }, [project.path]);

  if (error) {
    return (
      <div className="stack">
        <section className="card">
          <p className="warn">{error}</p>
        </section>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="stack">
        <section className="card">
          <p className="hint">Working it out…</p>
        </section>
      </div>
    );
  }

  const { coverage, risk, needs } = report;
  const needOf = new Map(needs.map((need) => [need.reqId, need]));

  return (
    <div className="stack">
      {section === "coverage" && (
      <section className="card">
        <header className="panel-head">
          <h2>Coverage</h2>
          <Pill kind="plain">{coverage.percent}% covered</Pill>
        </header>
        <p className="warn">
          Covered means a test case exists, not that anything passed. Nothing here has been run.
        </p>
        <div className="tiles">
          {[
            ["Covered", coverage.covered],
            ["Partial", coverage.partial],
            ["Gap", coverage.gap],
          ].map(([label, value]) => (
            <div className="tile" key={label as string}>
              <span className="tile-label">{label}</span>
              <span className="tile-value">{value}</span>
            </div>
          ))}
        </div>
        <Table
          columns={[
            { label: "Requirement", width: 96 },
            { label: "Title" },
            { label: "Source", width: 140 },
            { label: "Scenarios", width: 78, align: "right" },
            { label: "Rows", width: 62, align: "right" },
            { label: "Wanted", width: 78, align: "right" },
            { label: "Coverage", width: 92 },
          ]}
          rows={coverage.lines.map((line) => {
            const need = needOf.get(line.reqId);
            return {
              id: line.reqId,
              cells: [
                <span className="mono">{line.reqId}</span>,
                <>
                  {line.title}
                  {line.reason ? <span className="sub">{line.reason}</span> : null}
                  {line.rejected > 0 ? (
                    <span className="sub">{line.rejected} of its rows were rejected at scoring</span>
                  ) : null}
                </>,
                <span className="mono">{line.source}</span>,
                line.scenarioIds.length,
                line.caseCount,
                need ? `${need.casesNow} of ${need.casesRequired}` : "—",
                <Pill
                  kind={line.label === "Covered" ? "ok" : line.label === "Partial" ? "warn" : "bad"}
                >
                  {line.label}
                </Pill>,
              ],
            };
          })}
        />
      </section>
      )}

      {section === "risk" && (
      <section className="card">
        <header className="panel-head">
          <h2>Risk</h2>
          <Pill kind="plain">
            {risk.bands["P1"] ?? 0} · {risk.bands["P2"] ?? 0} · {risk.bands["P3"] ?? 0}
          </Pill>
        </header>
        <p className="hint">
          Priority times three, plus automation, plus class. Plain arithmetic — check any row by hand.
        </p>
        <Table
          columns={[
            { label: "#", width: 48, align: "right" },
            { label: "ID", width: 68 },
            { label: "Scenario" },
            { label: "Factors", width: 220 },
            { label: "Score", width: 96, align: "right" },
            { label: "Band", width: 64 },
            { label: "Cycle", width: 60 },
          ]}
          rows={risk.ranked.map((entry) => ({
            id: entry.id,
            cells: [
              entry.rank,
              <span className="mono">{entry.id}</span>,
              entry.title,
              <span className="sub">{entry.factors}</span>,
              <>
                {entry.score}
                <span className="sub">{entry.arithmetic}</span>
              </>,
              <Pill kind={entry.band === "P1" ? "bad" : entry.band === "P2" ? "warn" : "plain"}>
                {entry.band}
              </Pill>,
              entry.cycle,
            ],
          }))}
        />
      </section>
      )}
    </div>
  );
}
