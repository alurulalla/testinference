import { useEffect, useState, type ReactNode } from "react";
import Icon from "./ui/Icon";
import Logo from "./ui/Logo";
import type { CoreInfo, OpenProject, Summary } from "./types/api";
import type { Detail } from "./ui/detail";

export type View =
  | "home"
  | "documents"
  | "explore"
  | "code"
  | "runs"
  | "requirements"
  | "scenarios"
  | "gatea"
  | "tcer"
  | "coverage"
  | "risk"
  | "cases"
  | "bdd"
  | "validation"
  | "gateb"
  | "suites"
  | "publish"
  | "context"
  | "settings"
  | "assistant"
  | "projects"
  | "soon";

interface Item {
  id: View;
  label: string;
  icon: string;
  badge?: number;
  /** Still being built: clicking says so instead of doing nothing. */
  soon?: string;
}

interface Props {
  view: View;
  onView: (view: View, soon?: string) => void;
  project: OpenProject | null;
  summary: Summary | null;
  core: CoreInfo | null;
  detail: Detail;
  onAsk: (question: string) => void;
  children: ReactNode;
}

/** The rest of the product. Built later, listed now. */
const SECTIONS: Array<[string, Array<[string, string, string]>]> = [
  [
    "Run",
    [["Devices", "device", "discovering and leasing the devices a run needs"]],
  ],
  [
    "Fix",
    [
      ["Failures", "bug", "one inbox for local and CI failures, grouped by cause"],
      ["Fixes · Gate B", "wrench", "repairing broken tests and proving the repair"],
    ],
  ],
  [
    "Insights",
    [
      ["Reports", "report", "traceability and coverage you can send to someone"],
      ["Dashboards", "dash", "pass rate, flakiness and feature health over time"],
    ],
  ],
];

export default function Shell({
  view,
  onView,
  project,
  summary,
  core,
  detail,
  onAsk,
  children,
}: Props) {
  const [question, setQuestion] = useState("");
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ design: true, cases: true });

  // Escape closes the detail column, the way it closes everything else.
  const close = detail.close;
  useEffect(() => {
    if (!close) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const design: Item[] = [
    { id: "documents", label: "Documents", icon: "doc" },
    { id: "requirements", label: "Requirements", icon: "list" },
    { id: "scenarios", label: "Scenarios", icon: "rows" },
    { id: "gatea", label: "Gate A", icon: "check", ...(summary?.pendingGateA ? { badge: summary.pendingGateA } : {}) },
    { id: "tcer", label: "TCER", icon: "case" },
    { id: "coverage", label: "Coverage", icon: "chart" },
    { id: "risk", label: "Risk", icon: "risk" },
  ];
  const cases: Item[] = [
    { id: "cases", label: "Test cases", icon: "case" },
    { id: "bdd", label: "BDD", icon: "gherkin" },
    { id: "validation", label: "Validation", icon: "shield" },
    { id: "gateb", label: "Gate B", icon: "check", ...(summary?.pendingGateB ? { badge: summary.pendingGateB } : {}) },
    { id: "suites", label: "Suites", icon: "stack" },
    { id: "publish", label: "Publish", icon: "upload" },
  ];

  const item = (entry: Item, indent = false) => (
    <button
      type="button"
      key={entry.id + entry.label}
      title={entry.label}
      className={[
        "rail-item",
        indent ? "rail-sub" : "",
        view === entry.id && !entry.soon ? "rail-on" : "",
        entry.soon ? "rail-pending" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={project === null && !["projects", "settings", "home"].includes(entry.id)}
      onClick={() => onView(entry.id, entry.soon ? `${entry.label}|${entry.soon}` : undefined)}
    >
      <Icon name={entry.icon} />
      <span className="rail-text">{entry.label}</span>
      {entry.badge ? <span className="rail-badge">{entry.badge}</span> : null}
    </button>
  );

  const parent = (key: string, label: string, children: Item[]) => (
    <>
      <button
        type="button"
        className={open[key] ? "rail-item rail-parent rail-parent-open" : "rail-item rail-parent"}
        onClick={() => setOpen((previous) => ({ ...previous, [key]: !previous[key] }))}
        title={label}
      >
        <span className="rail-caret">{open[key] ? "▾" : "▸"}</span>
        <span className="rail-text">{label}</span>
      </button>
      {(open[key] || narrow) && children.map((entry) => item(entry, true))}
    </>
  );

  const stages: Array<[string, string, "done" | "waiting" | "idle"]> = [
    ["Requirements", `${summary?.requirements ?? 0}`, (summary?.requirements ?? 0) > 0 ? "done" : "idle"],
    ["Scenarios", `${summary?.scenarios ?? 0}`, (summary?.scenarios ?? 0) > 0 ? "done" : "idle"],
    [
      "Gate A",
      summary?.pendingGateA ? `${summary.pendingGateA} waiting` : "clear",
      summary?.pendingGateA ? "waiting" : (summary?.scenarios ?? 0) > 0 ? "done" : "idle",
    ],
    ["TCER", `${summary?.rows ?? 0}`, (summary?.rows ?? 0) > 0 ? "done" : "idle"],
    ["Cases", `${summary?.cases ?? 0}`, (summary?.cases ?? 0) > 0 ? "done" : "idle"],
    [
      "Gate B",
      summary?.pendingGateB ? `${summary.pendingGateB} waiting` : "clear",
      summary?.pendingGateB ? "waiting" : (summary?.cases ?? 0) > 0 ? "done" : "idle",
    ],
    ["Published", `${summary?.published ?? 0}`, (summary?.published ?? 0) > 0 ? "done" : "idle"],
    ["Explored", `${summary?.pages ?? 0}`, (summary?.pages ?? 0) > 0 ? "done" : "idle"],
    ["Tests", `${summary?.plans ?? 0}`, (summary?.plans ?? 0) > 0 ? "done" : "idle"],
    [
      "Last run",
      summary?.lastRun
        ? summary.lastRun.failed > 0
          ? `${summary.lastRun.failed} failed`
          : `${summary.lastRun.passed} passed`
        : "not yet",
      // A failing run is not "waiting on a person" the way a gate is, but
      // it is the one thing on this strip nobody should walk past.
      summary?.lastRun ? (summary.lastRun.failed > 0 ? "waiting" : "done") : "idle",
    ],
  ];

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">
          <Logo size={18} />
          TestInference
        </span>
        <span className="crumb">{project ? `${project.name} / ${title(view)}` : "no project open"}</span>
        <input
          type="search"
          className="command"
          value={question}
          placeholder="Ask TestInference or type a command…"
          disabled={project === null}
          onChange={(change) => setQuestion(change.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && question.trim().length > 0) {
              onAsk(question.trim());
              setQuestion("");
            }
          }}
        />
        <span className="spacer" />
        <span className="meta">{core ? `core ${core.version}` : ""}</span>
        <button type="button" className="ghost small" onClick={() => onView("publish")}>
          Push to repo
        </button>
      </header>

      {project && (
        <div className="strip">
          {stages.map(([label, value, state]) => (
            <span className={`stage stage-${state}`} key={label}>
              {label} <span className="stage-value">{value}</span>
            </span>
          ))}
        </div>
      )}

      <div className="body">
        <nav className={narrow ? "rail rail-narrow" : "rail"}>
          <div className="rail-group">
            {item({ id: "home", label: "Home", icon: "home" })}
            <button
              type="button"
              className="rail-collapse"
              title={narrow ? "widen the navigation" : "narrow the navigation"}
              aria-label={narrow ? "widen the navigation" : "narrow the navigation"}
              onClick={() => setNarrow(!narrow)}
            >
              {narrow ? "›" : "‹"}
            </button>
          </div>

          <div className="rail-group">
            <span className="rail-label">Author</span>
            {parent("design", "Test Design", design)}
            {parent("cases", "Test Cases", cases)}
          </div>

          <div className="rail-group">
            <span className="rail-label">Build</span>
            {item({ id: "explore", label: "Explore", icon: "explore" })}
            {item({ id: "code", label: "Tests · code", icon: "code" })}
            {item({ id: "runs", label: "Runs", icon: "play" })}
          </div>

          {SECTIONS.map(([label, items]) => (
            <div className="rail-group" key={label}>
              <span className="rail-label">{label}</span>
              {items.map(([name, icon, description]) =>
                item({ id: "soon", label: name, icon, soon: description }),
              )}
            </div>
          ))}

          <div className="rail-group">
            <span className="rail-label">Knowledge</span>
            {item({ id: "context", label: "App context", icon: "book" })}
            {item({ id: "assistant", label: "Assistant", icon: "chat" })}
          </div>

          <div className="rail-group rail-foot">
            {item({ id: "projects", label: "Projects", icon: "folder" })}
            {item({ id: "settings", label: "Settings", icon: "gear" })}
          </div>
        </nav>

        <main className="main">{children}</main>

        {detail.node && (
          <aside className="detail">
            {detail.close && (
              <button
                type="button"
                className="detail-close"
                onClick={detail.close}
                title="Close (Esc)"
                aria-label="Close the details"
              >
                <Icon name="close" />
              </button>
            )}
            {detail.node}
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <span title={summary?.judge.note}>{judging(summary)}</span>
        <span>{summary ? `${summary.decisions} decisions recorded` : "no project"}</span>
        <span className="spacer" />
        <span>{project ? saved(summary) : ""}</span>
      </footer>
    </div>
  );
}

/**
 * What is answering the small judgement calls.
 *
 * This said "Jev · off" whatever was switched on, which is worse than
 * saying nothing: a status bar that is wrong about one thing cannot be
 * trusted about the rest.
 */
function judging(summary: Summary | null): string {
  if (!summary) return "no project";
  const { mode, ready, model } = summary.judge;
  if (mode === "rules") return "Judging · rules";
  if (!ready) return `${mode === "jev" ? "Jev" : "Model"} · not set up`;
  return mode === "jev" ? `Jev · ${model ?? "on"}` : `Judging · ${model ?? "a model"}`;
}

/** Whether the project's own records have been committed. */
function saved(summary: Summary | null): string {
  const git = summary?.git;
  if (!git) return "Saved locally";
  if (!git.isRepo) return "Saved locally · not a git repository";
  if (git.contextChanged > 0) {
    return `Saved locally · ${git.contextChanged} not committed`;
  }
  return git.hasRemote ? "Committed" : "Committed · no remote";
}

function title(view: View): string {
  const names: Partial<Record<View, string>> = {
    home: "Home",
    documents: "Documents",
    requirements: "Requirements",
    scenarios: "Scenarios",
    gatea: "Gate A",
    tcer: "TCER",
    coverage: "Coverage",
    risk: "Risk",
    cases: "Test cases",
    bdd: "BDD",
    validation: "Validation",
    gateb: "Gate B",
    suites: "Suites",
    publish: "Publish",
    context: "App context",
    settings: "Settings",
    assistant: "Assistant",
    projects: "Projects",
  };
  return names[view] ?? "";
}
