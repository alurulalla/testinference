import { useCallback, useEffect, useState } from "react";
import Shell, { type View } from "./Shell";
import { DetailProvider, type Detail } from "./ui/detail";
import { call, describeError, isDesktopShell, on } from "./lib/ipc";
import AssistantPanel from "./panels/AssistantPanel";
import BddPanel from "./panels/BddPanel";
import CasesPanel from "./panels/CasesPanel";
import CoveragePanel from "./panels/CoveragePanel";
import DocumentsPanel from "./panels/DocumentsPanel";
import CodePanel from "./panels/CodePanel";
import ExplorePanel from "./panels/ExplorePanel";
import RunsPanel from "./panels/RunsPanel";
import HomePanel from "./panels/HomePanel";
import AppContextPanel from "./panels/AppContextPanel";
import SoonPanel from "./panels/SoonPanel";
import ModelsPanel from "./panels/ModelsPanel";
import ProjectsPanel from "./panels/ProjectsPanel";
import RequirementsPanel from "./panels/RequirementsPanel";
import ReviewPanel from "./panels/ReviewPanel";
import ScenariosPanel from "./panels/ScenariosPanel";
import TcerPanel from "./panels/TcerPanel";
import type { CoreInfo, OpenProject, Summary } from "./types/api";

export default function App() {
  const [view, setView] = useState<View>("home");
  const [detail, setDetail] = useState<Detail>({ node: null, close: null });
  const [asked, setAsked] = useState("");
  const [soon, setSoon] = useState("");
  const [core, setCore] = useState<CoreInfo | null>(null);
  const [project, setProject] = useState<OpenProject | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!project) return;
    try {
      setSummary(await call("project_summary", { projectPath: project.path }));
    } catch (cause: unknown) {
      setProblem(describeError(cause));
    }
  }, [project]);

  useEffect(() => {
    if (!isDesktopShell()) {
      setProblem("Running in a browser tab, so there is no core to talk to. Use npm run dev.");
      return;
    }
    call("core_info", {})
      .then(setCore)
      .catch((cause: unknown) => setProblem(describeError(cause)));

    // Open where you left off, rather than on an empty project list.
    void call("project_last", {})
      .then((last) => {
        if (last) setProject(last);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, view]);

  // Any run finishing changes the counts in the rail and the strip.
  useEffect(() => {
    let off: (() => void) | null = null;
    void on("run:finished", () => void refresh()).then((unlisten) => {
      off = unlisten;
    });
    return () => off?.();
  }, [refresh]);

  return (
    <Shell
      view={view}
      onView={(next, pending) => {
        setSoon(pending ?? "");
        setView(next);
      }}
      project={project}
      summary={summary}
      core={core}
      detail={detail}
      onAsk={(question) => {
        setAsked(question);
        setView("assistant");
      }}
    >
      <DetailProvider value={setDetail}>
      {problem && <p className="warn card">{problem}</p>}

      {view === "home" && <HomePanel project={project} summary={summary} onView={setView} />}
      {view === "projects" && (
        <ProjectsPanel
          open={project}
          onOpen={(opened) => {
            setProject(opened);
            setView("home");
          }}
          onRemoved={(path) => {
            if (project?.path === path) {
              setProject(null);
              setSummary(null);
            }
          }}
        />
      )}
      {project && view === "documents" && <DocumentsPanel project={project} />}
      {project && view === "explore" && <ExplorePanel project={project} />}
      {project && view === "code" && <CodePanel project={project} />}
      {project && view === "runs" && <RunsPanel project={project} />}
      {project && view === "requirements" && <RequirementsPanel project={project} />}
      {project && view === "scenarios" && <ScenariosPanel project={project} gate={false} />}
      {project && view === "gatea" && <ScenariosPanel project={project} gate />}
      {project && view === "tcer" && <TcerPanel project={project} />}
      {project && view === "coverage" && <CoveragePanel project={project} section="coverage" />}
      {project && view === "risk" && <CoveragePanel project={project} section="risk" />}
      {project && view === "cases" && <CasesPanel project={project} />}
      {project && view === "bdd" && <BddPanel project={project} />}
      {project && view === "validation" && <ReviewPanel project={project} section="validation" />}
      {project && view === "gateb" && <ReviewPanel project={project} section="gateb" />}
      {project && view === "suites" && <ReviewPanel project={project} section="suites" />}
      {project && view === "publish" && <ReviewPanel project={project} section="publish" />}
      {project && view === "context" && <AppContextPanel project={project} summary={summary} />}
      {project && view === "assistant" && <AssistantPanel project={project} asked={asked} />}
      {view === "soon" && <SoonPanel what={soon} />}
      {view === "settings" && <ModelsPanel project={project} onProject={setProject} />}
      </DetailProvider>
    </Shell>
  );
}
