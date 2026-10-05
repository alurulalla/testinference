import { useEffect, useState } from "react";
import { call, describeError } from "../lib/ipc";
import type {
  JudgeState,
  ModelSummary,
  OpenProject,
  ProviderStatus,
  SelfTest,
  Settings,
} from "../types/api";

/** Providers that hold models. Jev is a judgement service, handled separately. */
const MODEL_PROVIDERS = ["anthropic", "openai", "gemini", "local"];

/** Who answers the small judgement calls. Rules always go first. */
const MODES = [
  { id: "rules", label: "Rules only", detail: "free, instant, nothing leaves the machine" },
  { id: "model", label: "The model assigned to judging", detail: "asked in one batch, on your key" },
  {
    id: "jev",
    label: "Jev",
    detail: "every question graded 0 to 1, with how sure it is",
  },
] as const;

export default function ModelsPanel({
  project,
  onProject,
}: {
  project: OpenProject | null;
  onProject: (project: OpenProject) => void;
}) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<Record<string, ModelSummary[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [endpoints, setEndpoints] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [judge, setJudge] = useState<JudgeState | null>(null);
  const [jevModel, setJevModel] = useState("");
  const [name, setName] = useState(project?.name ?? "");
  const [url, setUrl] = useState(project?.appUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!project) {
      setJudge(null);
      return;
    }
    void call("judge_state", { projectPath: project.path })
      .then(setJudge)
      .catch((cause: unknown) => setError(describeError(cause)));
  }, [project?.path]);

  useEffect(() => {
    setName(project?.name ?? "");
    setUrl(project?.appUrl ?? "");
  }, [project?.path, project?.name, project?.appUrl]);

  async function refresh() {
    try {
      const [list, current] = await Promise.all([
        call("provider_list", {}),
        call("settings_get", {}),
      ]);
      setProviders(list);
      setSettings(current);
      setEndpoints({
        local: current.localEndpoint ?? "",
        openai: current.openaiEndpoint ?? "",
        jev: current.jevEndpoint ?? "",
      });
      setJevModel(current.jevModel ?? "");
      if (project) setJudge(await call("judge_state", { projectPath: project.path }));
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  async function run(what: string, action: () => Promise<unknown>) {
    setBusy(what);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  /** Jev's price lives under the same provider:model key as any other. */
  const jevId = `jev:${jevModel.trim() || "jev-latest"}`;

  /** Every model that has passed a self-test, offered for assignment. */
  const tested = Object.entries(settings?.capabilities ?? {}).filter(
    ([, result]) => (result as SelfTest).ok,
  );

  return (
    <div className="stack">
      {project && (
        <section className="card">
          <header className="panel-head">
            <h2>Project</h2>
            <span className="pill">{project.id}</span>
          </header>
          <div className="budgets">
            <div className="field">
              <label htmlFor="project-name">Name</label>
              <input
                id="project-name"
                type="text"
                value={name}
                onChange={(change) => setName(change.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="project-url">Application URL</label>
              <input
                id="project-url"
                type="url"
                value={url}
                placeholder="https://example.com"
                onChange={(change) => setUrl(change.target.value)}
              />
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              disabled={busy !== null || name.trim().length === 0}
              onClick={() => {
                setBusy("project");
                void call("project_edit", { path: project.path, name, appUrl: url })
                  .then(onProject)
                  .catch((cause: unknown) => setError(describeError(cause)))
                  .finally(() => setBusy(null));
              }}
            >
              Save
            </button>
            <span className="hint">{project.contextPath}</span>
          </div>
        </section>
      )}

      {error && (
        <section className="card">
          <p className="warn">{error}</p>
        </section>
      )}

      {project && (
        <section className="card">
          <header className="panel-head">
            <h2>Judgement</h2>
            <span className={judge?.ready ? "pill pill-valid" : "pill pill-unknown"}>
              {judge?.mode ?? "rules"}
            </span>
          </header>
          <p className="hint">
            Small yes-or-no calls run through here: is this requirement too vague to test, do these
            two say the same thing. With rules or a model, code answers first and only passes on
            what it is unsure about. Jev answers all of them — it returns a number from 0 to 1
            instead of a yes, so it can say "I don't know", which is the thing code cannot do.
          </p>
          <div className="rows">
            {MODES.map((option) => (
              <label className="row" key={option.id}>
                <input
                  type="radio"
                  name="judge-mode"
                  checked={(judge?.mode ?? "rules") === option.id}
                  onChange={() =>
                    void run("judge", async () => {
                      await call("judge_set_mode", { projectPath: project.path, mode: option.id });
                      setJudge(await call("judge_state", { projectPath: project.path }));
                    })
                  }
                />
                <span className="row-main">{option.label}</span>
                <span className="row-sub">{option.detail}</span>
              </label>
            ))}
          </div>
          {judge && <p className={judge.ready ? "hint" : "warn"}>{judge.note}</p>}

          {(judge?.mode ?? "rules") === "jev" && (
            <>
              <div className="budgets">
                <div className="field">
                  <label htmlFor="jev-key">
                    {providers.find((entry) => entry.id === "jev")?.hasKey
                      ? "Replace the saved key"
                      : "Jev key"}
                  </label>
                  <input
                    id="jev-key"
                    type="password"
                    autoComplete="off"
                    value={drafts["jev"] ?? ""}
                    placeholder="from the TypeSafe dashboard"
                    onChange={(change) =>
                      setDrafts((previous) => ({ ...previous, jev: change.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="jev-model">Model</label>
                  <input
                    id="jev-model"
                    type="text"
                    value={jevModel}
                    placeholder="jev-latest"
                    onChange={(change) => setJevModel(change.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="jev-endpoint">Endpoint</label>
                  <input
                    id="jev-endpoint"
                    type="url"
                    value={endpoints["jev"] ?? ""}
                    placeholder="https://api.typesafe.ai/v1"
                    onChange={(change) =>
                      setEndpoints((previous) => ({ ...previous, jev: change.target.value }))
                    }
                  />
                </div>
              </div>
              <p className="hint">
                The endpoint is only for a proxy or a private deployment — leave it empty for
                TypeSafe's own.
              </p>

              <div className="budgets">
                <div className="field">
                  <label htmlFor="jev-in">$ per million input tokens</label>
                  <input
                    id="jev-in"
                    type="number"
                    step="0.001"
                    value={settings?.prices[jevId]?.inputPerMillion ?? ""}
                    placeholder="0"
                    onChange={(change) =>
                      void run("jev-price", () =>
                        call("price_set", {
                          model: jevId,
                          inputPerMillion: Number(change.target.value),
                          outputPerMillion: settings?.prices[jevId]?.outputPerMillion ?? 0,
                        }),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="jev-out">$ per million output tokens</label>
                  <input
                    id="jev-out"
                    type="number"
                    step="0.001"
                    value={settings?.prices[jevId]?.outputPerMillion ?? ""}
                    placeholder="0"
                    onChange={(change) =>
                      void run("jev-price", () =>
                        call("price_set", {
                          model: jevId,
                          inputPerMillion: settings?.prices[jevId]?.inputPerMillion ?? 0,
                          outputPerMillion: Number(change.target.value),
                        }),
                      )
                    }
                  />
                </div>
              </div>
              <p className="hint">
                TypeSafe's own page listed $0.042 per million input tokens, output free, when this
                was written. Prices change, so nothing is assumed — what you type here is what the
                spend guard uses.
              </p>

              <div className="actions">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("jev", async () => {
                      await call("provider_set_endpoint", {
                        provider: "jev",
                        endpoint: endpoints["jev"] ?? "",
                      });
                      await call("jev_set_model", { model: jevModel });
                      if ((drafts["jev"] ?? "").trim()) {
                        await call("provider_set_key", { provider: "jev", key: drafts["jev"] ?? "" });
                        setDrafts((previous) => ({ ...previous, jev: "" }));
                      }
                      setJudge(await call("judge_state", { projectPath: project.path }));
                    })
                  }
                >
                  Save Jev details
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy !== null}
                  onClick={() => void run("jev-check", () => call("provider_validate", { provider: "jev" }))}
                >
                  {busy === "jev-check" ? "Checking…" : "Check the key"}
                </button>
                {providers.find((entry) => entry.id === "jev")?.validation && (
                  <span
                    className={
                      providers.find((entry) => entry.id === "jev")?.validation?.state === "valid"
                        ? "hint"
                        : "warn"
                    }
                  >
                    {providers.find((entry) => entry.id === "jev")?.validation?.detail}
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {MODEL_PROVIDERS.map((provider) => {
        const status = providers.find((entry) => entry.id === provider);
        const takesEndpoint = provider === "local" || provider === "openai";
        const found = models[provider] ?? [];

        return (
          <section className="card" key={provider}>
            <header className="panel-head">
              <h2>{status?.label ?? provider}</h2>
              {status?.hasKey ? (
                <span className="pill pill-valid">key saved</span>
              ) : (
                <span className="pill pill-unknown">no key</span>
              )}
            </header>

            {takesEndpoint && (
              <div className="field">
                <label htmlFor={`endpoint-${provider}`}>Endpoint</label>
                <input
                  id={`endpoint-${provider}`}
                  type="url"
                  value={endpoints[provider] ?? ""}
                  placeholder={
                    provider === "local" ? "http://localhost:11434/v1" : "https://api.openai.com/v1"
                  }
                  onChange={(change) =>
                    setEndpoints((previous) => ({ ...previous, [provider]: change.target.value }))
                  }
                />
              </div>
            )}

            <div className="field">
              <label htmlFor={`key-${provider}`}>
                {status?.hasKey ? "Replace the saved key" : "API key"}
              </label>
              <input
                id={`key-${provider}`}
                type="password"
                autoComplete="off"
                value={drafts[provider] ?? ""}
                placeholder={provider === "local" ? "usually not needed" : "paste your key"}
                onChange={(change) =>
                  setDrafts((previous) => ({ ...previous, [provider]: change.target.value }))
                }
              />
            </div>

            <div className="actions">
              <button
                type="button"
                disabled={busy !== null || !(drafts[provider] ?? "").trim()}
                onClick={() =>
                  void run(provider, async () => {
                    await call("provider_set_key", { provider, key: drafts[provider] ?? "" });
                    setDrafts((previous) => ({ ...previous, [provider]: "" }));
                  })
                }
              >
                Save key
              </button>

              {takesEndpoint && (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(provider, () =>
                      call("provider_set_endpoint", {
                        provider,
                        endpoint: endpoints[provider] ?? "",
                      }),
                    )
                  }
                >
                  Save endpoint
                </button>
              )}

              <button
                type="button"
                className="ghost"
                disabled={busy !== null}
                onClick={() =>
                  void run(provider, async () => {
                    const list = await call("models_list", { provider });
                    setModels((previous) => ({ ...previous, [provider]: list }));
                  })
                }
              >
                {busy === provider ? "Asking…" : "List models"}
              </button>
            </div>

            {found.length > 0 && (
              <div className="rows">
                {found.slice(0, 12).map((model) => {
                  const id = `${provider}:${model.id}`;
                  const result = settings?.capabilities[id];
                  return (
                    <div className="row" key={id}>
                      <span className="row-main">{model.label}</span>
                      <span className="row-sub">
                        {id}
                        {model.contextWindow ? ` · ${model.contextWindow.toLocaleString()} tokens` : ""}
                        {result
                          ? ` · ${result.ok ? result.capabilities?.note : result.detail}${
                              result.capabilities ? ` · ${result.capabilities.latencyMs} ms` : ""
                            }`
                          : ""}
                      </span>
                      <span className="row-actions">
                        {result?.ok && (
                          <span className="price">
                            <label htmlFor={`in-${id}`}>$ / M in</label>
                            <input
                              id={`in-${id}`}
                              type="number"
                              step="0.01"
                              value={settings?.prices[id]?.inputPerMillion ?? ""}
                              placeholder="0"
                              onChange={(change) =>
                                void run(id, () =>
                                  call("price_set", {
                                    model: id,
                                    inputPerMillion: Number(change.target.value),
                                    outputPerMillion: settings?.prices[id]?.outputPerMillion ?? 0,
                                  }),
                                )
                              }
                            />
                            <label htmlFor={`out-${id}`}>out</label>
                            <input
                              id={`out-${id}`}
                              type="number"
                              step="0.01"
                              value={settings?.prices[id]?.outputPerMillion ?? ""}
                              placeholder="0"
                              onChange={(change) =>
                                void run(id, () =>
                                  call("price_set", {
                                    model: id,
                                    inputPerMillion: settings?.prices[id]?.inputPerMillion ?? 0,
                                    outputPerMillion: Number(change.target.value),
                                  }),
                                )
                              }
                            />
                          </span>
                        )}
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(id, () =>
                              call("model_self_test", {
                                model: id,
                                ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
                              }),
                            )
                          }
                        >
                          {busy === id ? "Testing…" : result ? "Test again" : "Self-test"}
                        </button>
                      </span>
                    </div>
                  );
                })}
                {found.length > 12 && (
                  <p className="hint">{found.length - 12} more not shown.</p>
                )}
              </div>
            )}
          </section>
        );
      })}

      <section className="card">
        <h2>Which model does which job</h2>
        <p className="hint">
          Only models that passed a self-test are offered. The jobs are not equally hard.
        </p>
        <div className="rows">
          {(settings?.jobs ?? []).map((job) => (
            <div className="row" key={job.id}>
              <span className="row-main">{job.label}</span>
              <span className="row-sub">{job.model ?? "not assigned"}</span>
              <select
                value={job.model ?? ""}
                onChange={(change) =>
                  void run(job.id, () =>
                    call("assignment_set", { job: job.id, model: change.target.value }),
                  )
                }
              >
                <option value="">not assigned</option>
                {tested.map(([id]) => (
                  <option value={id} key={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        {tested.length === 0 && (
          <p className="hint">Nothing to assign yet — list a provider's models and self-test one.</p>
        )}
      </section>

      <section className="card">
        <h2>Spend guards</h2>
        <div className="budgets">
          <div className="field">
            <label htmlFor="per-run">Stop a run above</label>
            <input
              id="per-run"
              type="number"
              step="1"
              value={settings?.budgets.perRun ?? 10}
              onChange={(change) =>
                void run("budgets", () =>
                  call("budgets_set", {
                    perRun: Number(change.target.value),
                    monthly: settings?.budgets.monthly ?? 150,
                    maxParallel: settings?.budgets.maxParallel ?? 4,
                  }),
                )
              }
            />
          </div>
          <div className="field">
            <label htmlFor="monthly">Monthly cap</label>
            <input
              id="monthly"
              type="number"
              step="10"
              value={settings?.budgets.monthly ?? 150}
              onChange={(change) =>
                void run("budgets", () =>
                  call("budgets_set", {
                    perRun: settings?.budgets.perRun ?? 10,
                    monthly: Number(change.target.value),
                    maxParallel: settings?.budgets.maxParallel ?? 4,
                  }),
                )
              }
            />
          </div>
          <div className="field">
            <label htmlFor="parallel">Calls at once</label>
            <input
              id="parallel"
              type="number"
              step="1"
              value={settings?.budgets.maxParallel ?? 4}
              onChange={(change) =>
                void run("budgets", () =>
                  call("budgets_set", {
                    perRun: settings?.budgets.perRun ?? 10,
                    monthly: settings?.budgets.monthly ?? 150,
                    maxParallel: Number(change.target.value),
                  }),
                )
              }
            />
          </div>
        </div>
        <p className="hint">
          A run stops at the per-run limit. That needs the model's price, which you set beside it
          above — published prices change, so nothing is assumed.
        </p>
      </section>
    </div>
  );
}
