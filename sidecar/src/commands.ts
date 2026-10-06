import { askToStop } from "./runs/cancel.js";
import * as assistant from "./runs/assistant.js";
import * as bddRun from "./runs/bdd.js";
import * as casesRun from "./runs/cases.js";
import * as codeRun from "./runs/code.js";
import * as designRun from "./runs/design.js";
import * as discuss from "./runs/discuss.js";
import * as documents from "./runs/documents.js";
import * as drift from "./runs/drift.js";
import * as exploreRun from "./runs/explore.js";
import * as extractRun from "./runs/extract.js";
import * as gates from "./runs/gates.js";
import * as importer from "./runs/import.js";
import * as judge from "./runs/judge.review.js";
import { keyFor } from "./runs/keys.js";
import * as providers from "./runs/providers.js";
import * as runner from "./runs/runner.js";
import * as tcerRun from "./runs/tcer.js";
import * as views from "./runs/views.js";
import * as git from "./store/git.js";
import * as store from "./store/index.js";
import * as project from "./store/project.js";
import * as library from "./store/steps.js";
import * as settings from "./store/settings.js";

/**
 * Everything the window can ask for, by the name it asks with.
 *
 * This is the whole of what used to be ninety Tauri commands in Rust.
 * The names and the argument shapes are unchanged, so the window does not
 * know the difference — which is the point: moving the logic should not
 * be a thing a screen has to be told about.
 */

type Params = Record<string, unknown>;
type Handler = (params: Params) => unknown;

function text(params: Params, key: string): string {
  const value = params[key];
  if (typeof value !== "string") throw new Error(`${key} is missing`);
  return value;
}

function maybe(params: Params, key: string): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

function number(params: Params, key: string): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} is missing`);
  return value;
}

function flag(params: Params, key: string): boolean {
  return params[key] === true;
}

function list(params: Params, key: string): string[] {
  const value = params[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The project every other command is about. */
const at = (params: Params) => text(params, "projectPath");

// The estimate each stage shows has its own field names. They were named
// for what the stage counts, and the screens read them by those names.
const forExtract = (e: ReturnType<typeof designRun.estimate>, documents: number) => ({
  ...e,
  documents,
  requirements: 0,
  pieces: e.units,
});

export const commands: Record<string, Handler> = {
  // ── projects ──────────────────────────────────────────────────────────
  project_list: () => project.listProjects(),
  project_create: (p) =>
    project.createProject(text(p, "name"), text(p, "appUrl"), maybe(p, "folder") ?? undefined),
  project_open: (p) => {
    const opened = project.openProject(text(p, "path"));
    settings.update({ lastProject: opened.path });
    return opened;
  },
  project_last: () => {
    const last = settings.load().lastProject;
    if (!last) return null;
    try {
      return project.openProject(last);
    } catch {
      // A project that has gone is not an error on opening the app.
      return null;
    }
  },
  project_edit: (p) => project.editProject(text(p, "path"), text(p, "name"), text(p, "appUrl")),
  project_remove: (p) => {
    const path = text(p, "path");
    const removed = project.removeProject(path, flag(p, "deleteFiles"));
    // Do not reopen a project that is no longer there.
    if (settings.load().lastProject === path) settings.update({ lastProject: null });
    return removed;
  },
  project_summary: (p) => views.summary(at(p)),

  // ── documents and requirements ────────────────────────────────────────
  document_add: (p) => documents.add(at(p), text(p, "sourcePath")),
  document_list: (p) => store.documents.list(at(p)),
  document_chunks: (p) => documents.chunks(at(p), text(p, "documentId"), number(p, "limit")),
  extract_estimate: (p) =>
    forExtract(extractRun.plan(at(p)).estimate, store.documents.count(at(p))),
  extract_plan: (p) => {
    const delta = extractRun.plan(at(p));
    return { ...delta, estimate: forExtract(delta.estimate, store.documents.count(at(p))) };
  },
  extract_run: (p) => extractRun.run(at(p), p["delta"] !== false),
  // One stop for everything, because the window has one Stop button and
  // only one run is ever going.
  extract_cancel: () => {
    for (const kind of ["extract", "design", "tcer", "cases", "bdd"]) askToStop(kind);
    return null;
  },
  requirement_list: (p) => store.requirements.list(at(p)),
  requirements_drop_orphans: (p) => gates.dropOrphans(at(p), flag(p, "includeEdited")),
  requirements_export: (p) => gates.exportRequirements(at(p)),
  run_list: (p) => store.runs.list(at(p)),

  // ── discussing a requirement, and where the documents disagree ────────
  requirement_discuss: (p) =>
    discuss.send(at(p), text(p, "reqId"), text(p, "said"), p["history"] ?? []),
  requirement_apply_wording: (p) =>
    discuss.apply(
      at(p),
      text(p, "reqId"),
      text(p, "title"),
      maybe(p, "acceptance") ?? "",
      (p["turns"] ?? []) as store.Turn[],
    ),
  requirement_keep_discussion: (p) =>
    discuss.keep(at(p), text(p, "reqId"), (p["turns"] ?? []) as store.Turn[]),
  requirement_discussions: (p) => discuss.forRequirement(at(p), text(p, "reqId")),
  document_drift: (p) => drift.check(at(p)),
  document_drift_export: async (p) => drift.writeReport(at(p), await drift.check(at(p))),

  // ── scenarios and Gate A ──────────────────────────────────────────────
  design_estimate: (p) => {
    const e = designRun.estimate(at(p));
    return { ...e, requirements: e.units, documents: 0, pieces: 0 };
  },
  design_plan: (p) => views.designPlan(at(p)),
  design_run: (p) => designRun.run(at(p), p["delta"] !== false),
  scenario_list: (p) => store.scenarios.list(at(p)),
  scenario_decide: (p) =>
    gates.decideScenarios(at(p), list(p, "ids"), text(p, "verdict"), maybe(p, "comment")),
  scenario_review: (p) => views.scenarioReview(at(p)),

  // ── TCER, coverage, risk ──────────────────────────────────────────────
  tcer_estimate: (p) => {
    const e = tcerRun.estimate(at(p));
    const approved = store.scenarios.list(at(p)).filter((item) => item.state === "approved").length;
    return { ...e, approved, complete: approved - e.units, toComplete: e.units };
  },
  tcer_run: (p) => tcerRun.run(at(p)),
  tcer_list: (p) => store.tcer.list(at(p)),
  tcer_amend: (p) =>
    gates.amendRow(
      at(p),
      text(p, "tcId"),
      typeof p["removed"] === "boolean" ? p["removed"] : null,
      maybe(p, "comment"),
    ),
  coverage_get: (p) => views.coverage(at(p)),

  // ── test cases, Gate B ────────────────────────────────────────────────
  cases_estimate: (p) => {
    const e = casesRun.estimate(at(p));
    return { ...e, rows: e.units };
  },
  cases_run: (p) => casesRun.run(at(p)),
  case_list: (p) => store.cases.list(at(p)),
  cases_validate: (p) => views.validate(at(p)),
  cases_verify: (p) => views.verifyCases(at(p)),
  case_decide: (p) =>
    gates.decideCases(at(p), list(p, "ids"), text(p, "verdict"), maybe(p, "comment")),

  // ── cases that already exist ──────────────────────────────────────────
  cases_import_preview: (p) => importer.preview(at(p), text(p, "sourcePath")),
  cases_import: (p) =>
    importer.importCases(at(p), text(p, "sourcePath"), (p["mapping"] ?? {}) as Record<string, number>),
  cases_link_propose: (p) => importer.proposeLinks(at(p)),
  cases_link_apply: (p) => importer.applyLinks(at(p), (p["links"] ?? []) as Array<[string, string]>),
  cases_derive_spine: (p) => importer.deriveSpine(at(p)),

  // ── BDD, suites, publishing ───────────────────────────────────────────
  bdd_estimate: (p) => {
    const e = bddRun.estimate(at(p));
    return { ...e, cases: e.units, library: library.read(at(p)).length };
  },
  bdd_run: (p) => bddRun.run(at(p)),
  bdd_list: (p) => store.bdd.list(at(p)),
  steps_list: (p) => library.read(at(p)),
  suite_list: (p) => gates.listSuites(at(p)),
  suite_toggle: (p) => gates.toggleSuite(at(p), text(p, "suiteId"), text(p, "caseId")),
  suite_fill_from_risk: (p) => gates.fillFromRisk(at(p), text(p, "suiteId"), text(p, "band")),
  publish_run: (p) => gates.publish(at(p), text(p, "target")),
  feasibility_get: (p) => views.feasibility(at(p)),
  git_status: (p) => git.status(at(p)),
  git_commit: (p) =>
    git.commit(at(p), text(p, "message"), flag(p, "includeContext"), flag(p, "push")),

  // ── reading the product ───────────────────────────────────────────────
  explore_run: (p) =>
    exploreRun.run(at(p), number(p, "pages"), number(p, "depth"), flag(p, "freshStart")),
  explore_map: (p) => store.appPages.list(at(p)),
  sign_in_set: (p) => {
    const path = at(p);
    const username = text(p, "username").trim();
    const password = text(p, "password").trim();
    const submit = text(p, "submit").trim();
    if (!username || !password || !submit) throw new Error("point all three fields at the login form");

    // The password is already with the keychain by now — the window sends
    // it there first — so what is checked is that one exists.
    if (keyFor(`signin:${project.readContext(path).id}`) === null) {
      throw new Error("a test account needs a password");
    }
    project.setSignIn(path, { username, password, submit, user: text(p, "user").trim() });
    return null;
  },
  sign_in_clear: (p) => {
    project.setSignIn(at(p), null);
    return null;
  },
  code_estimate: (p) => codeRun.estimate(at(p)),
  code_run: (p) => codeRun.run(at(p)),
  tests_run: (p) => runner.run(at(p), maybe(p, "only"), flag(p, "watch")),
  tests_history: (p) => runner.history(at(p)),
  plan_list: (p) => store.plans.list(at(p)),

  // ── the assistant ─────────────────────────────────────────────────────
  assistant_ask: (p) => assistant.ask(at(p), text(p, "question"), p["history"] ?? []),
  assistant_apply: (p) => assistant.apply(at(p), (p["proposal"] ?? {}) as Record<string, unknown>),
  assistant_undo: (p) => assistant.undo(at(p)),

  // ── judgement ─────────────────────────────────────────────────────────
  judge_state: (p) => judge.readiness(at(p)),
  judge_set_mode: (p) => {
    project.setJudgeMode(at(p), text(p, "mode"));
    return null;
  },
  judge_review: (p) => judge.reviewRequirements(at(p)),
  jev_set_model: (p) => {
    providers.setJevModel(text(p, "model"));
    return null;
  },

  // ── settings and providers ────────────────────────────────────────────
  settings_get: () => providers.settingsGet(),
  assignment_set: (p) => {
    providers.setAssignment(text(p, "job"), text(p, "model"));
    return null;
  },
  budgets_set: (p) => {
    providers.setBudgets(number(p, "perRun"), number(p, "monthly"), number(p, "maxParallel"));
    return null;
  },
  price_set: (p) => {
    providers.setPrice(text(p, "model"), number(p, "inputPerMillion"), number(p, "outputPerMillion"));
    return null;
  },
  provider_list: () => providers.providerList(),
  provider_set_endpoint: (p) => {
    providers.setEndpoint(text(p, "provider"), text(p, "endpoint"));
    return null;
  },
  provider_validate: (p) => providers.validateProvider(text(p, "provider")),
  models_list: (p) => providers.modelsList(text(p, "provider")),
  model_self_test: (p) =>
    providers.modelSelfTest(
      text(p, "model"),
      typeof p["contextWindow"] === "number" ? p["contextWindow"] : null,
    ),

  // ── the keychain, which the shell owns ────────────────────────────────
  "keys.remember": (p) => {
    providers.keyChanged(text(p, "name"), maybe(p, "value"));
    return null;
  },
  /**
   * The names the shell should look up in the keychain and hand over:
   * every provider, and the sign-in of every project.
   */
  "keys.wanted": () => [
    ...providers.PROVIDERS.map(([id]) => id),
    ...project.listProjects().map((entry) => `signin:${entry.id}`),
  ],
};
