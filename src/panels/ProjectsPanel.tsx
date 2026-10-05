import { useEffect, useState } from "react";
import { call, describeError } from "../lib/ipc";
import type { OpenProject, ProjectRef } from "../types/api";

interface Props {
  open: OpenProject | null;
  onOpen: (project: OpenProject) => void;
  /** So the shell stops showing a project that is no longer there. */
  onRemoved: (path: string) => void;
}

export default function ProjectsPanel({ open, onOpen, onRemoved }: Props) {
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [name, setName] = useState("");
  const [appUrl, setAppUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setProjects(await call("project_list", {}));
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  async function run<T>(action: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (cause: unknown) {
      setError(describeError(cause));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const stored = open?.counts.reduce((total, count) => total + count.files, 0) ?? 0;

  return (
    <div className="stack">
      <section className="card">
        <h2>New project</h2>
        <div className="field">
          <label htmlFor="pname">Name</label>
          <input
            id="pname"
            type="text"
            value={name}
            placeholder="My project"
            onChange={(change) => setName(change.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="purl">Application URL</label>
          <input
            id="purl"
            type="url"
            value={appUrl}
            placeholder="https://example.com"
            onChange={(change) => setAppUrl(change.target.value)}
          />
        </div>
        <div className="actions">
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              void run(async () => {
                const created = await call("project_create", { name, appUrl });
                onOpen(created);
                setName("");
                setAppUrl("");
                await refresh();
              })
            }
          >
            Create project
          </button>
          {error && <span className="warn">{error}</span>}
        </div>
      </section>

      <section className="card">
        <header className="panel-head">
          <h2>Projects</h2>
          <span className="pill pill-unknown">{projects.length}</span>
        </header>
        {removed && <p className="hint">{removed}</p>}
        {projects.length === 0 ? (
          <p className="hint">No projects yet.</p>
        ) : (
          <div className="rows">
            {projects.map((project) => (
              <div key={project.id}>
                <div className="row">
                  <span className="row-main">{project.name}</span>
                  <span className="row-sub">{project.path}</span>
                  <span className="row-actions">
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => onOpen(await call("project_open", { path: project.path })))
                      }
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => {
                        setRemoved(null);
                        setRemoving(removing === project.path ? null : project.path);
                      }}
                    >
                      Remove
                    </button>
                  </span>
                </div>

                {removing === project.path && (
                  <div className="estimate">
                    <p className="hint">
                      {project.path.includes("/dev.testinference.desktop/projects/")
                        ? "This project lives in the app's own folder, so everything in it goes together."
                        : "This project lives in a folder you chose. Only its .testinference folder can go — the folder itself, and anything else in it, stays."}{" "}
                      Nothing is deleted outright: files go to the Trash, where you can get them
                      back until you empty it.
                    </p>
                    <div className="actions">
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const result = await call("project_remove", {
                              path: project.path,
                              deleteFiles: false,
                            });
                            setRemoving(null);
                            setRemoved(result.note);
                            onRemoved(project.path);
                            await refresh();
                          })
                        }
                      >
                        Just take it off the list
                      </button>
                      <button
                        type="button"
                        className="ghost danger"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const result = await call("project_remove", {
                              path: project.path,
                              deleteFiles: true,
                            });
                            setRemoving(null);
                            setRemoved(result.note);
                            onRemoved(project.path);
                            await refresh();
                          })
                        }
                      >
                        Remove and move its files to the Trash
                      </button>
                      <button type="button" className="ghost" onClick={() => setRemoving(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {open && (
        <section className="card">
          <header className="panel-head">
            <h2>{open.name}</h2>
            <span className="pill pill-valid">open</span>
          </header>
          {open.recovered && (
            <p className="warn">
              An interrupted write was finished as this opened: {open.recovered}
            </p>
          )}
          <dl className="facts">
            <div>
              <dt>Application</dt>
              <dd>{open.appUrl || "—"}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{new Date(open.createdAt).toLocaleString()}</dd>
            </div>
          </dl>
          <div className="field">
            <span className="hint">Folder</span>
            <code className="path">{open.contextPath}</code>
          </div>
          <div className="counts">
            {open.counts.map((count) => (
              <span className="count" key={count.folder}>
                <span className="count-n">{count.files}</span>
                {count.folder}
              </span>
            ))}
          </div>
          <p className="hint">
            {stored === 0
              ? "Nothing stored yet."
              : `${stored} records stored.`}
          </p>
        </section>
      )}
    </div>
  );
}
