/**
 * The typed surface of the local API.
 *
 * Every command here has a matching `#[tauri::command]` in src-tauri/src/lib.rs,
 * and every event a matching `app.emit` in the core. The UI holds no business
 * logic of its own: it sends commands and renders what comes back.
 */

export interface CoreInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  tauriVersion: string;
}

export type WorkerState = "starting" | "ready" | "restarting" | "failed";

export interface WorkerStatus {
  state: WorkerState;
  pid: number | null;
  restarts: number;
  detail: string | null;
}

export interface WorkerPong {
  message: string;
  pid: number;
  ts: number;
}

export type ValidationState = "valid" | "invalid" | "unreachable" | "unsupported" | "missing" | "error";

export interface ValidationResult {
  state: ValidationState;
  detail: string | null;
  checkedAtMs: number;
}

export interface ProviderStatus {
  id: string;
  label: string;
  hasKey: boolean;
  endpoint: string | null;
  validation: ValidationResult | null;
}

export interface ProjectRef {
  id: string;
  name: string;
  path: string;
}

export interface FolderCount {
  folder: string;
  files: number;
}

export interface OpenProject {
  id: string;
  name: string;
  appUrl: string;
  path: string;
  contextPath: string;
  createdAt: string;
  counts: FolderCount[];
  /** Set when an interrupted write had to be finished as the project opened. */
  recovered: string | null;
}

export interface DocumentRecord {
  id: string;
  name: string;
  kind: string;
  pages: number | null;
  chunks: number;
  bytes: number;
  fingerprint: string;
  addedAt: string;
  warning: string | null;
}

export interface DocumentAdded {
  outcome: "added" | "unchanged" | "replaced";
  record: DocumentRecord;
}

export interface Chunk {
  index: number;
  text: string;
  page: number | null;
  block: number;
  heading: string | null;
  hash: string;
}

export interface ModelSummary {
  id: string;
  label: string;
  contextWindow: number | null;
}

export interface Capabilities {
  structured: boolean;
  latencyMs: number;
  contextWindow: number | null;
  note: string;
}

export interface SelfTest {
  ok: boolean;
  capabilities: Capabilities | null;
  detail: string;
}

export interface Job {
  id: string;
  label: string;
  model: string | null;
}

export interface Budgets {
  perRun: number;
  monthly: number;
  maxParallel: number;
}

export interface Settings {
  jobs: Job[];
  budgets: Budgets;
  capabilities: Record<string, SelfTest>;
  prices: Record<string, Price>;
  localEndpoint: string | null;
  openaiEndpoint: string | null;
  jevEndpoint: string | null;
  jevModel: string | null;
  privateMode: boolean;
}

/** Who answers the small judgement calls for a project, and whether it can. */
export interface JudgeState {
  mode: "rules" | "model" | "jev";
  ready: boolean;
  model: string | null;
  note: string;
}

export interface Finding {
  kind: "vague" | "duplicate";
  id: string;
  other: string | null;
  confidence: number;
  why: string;
  action: "act" | "verify" | "ask";
  by: "rules" | "model" | "jev";
}

export interface Review {
  mode: "rules" | "model" | "jev";
  checked: number;
  /** How many questions were put to a judge rather than answered by code. */
  asked: number;
  findings: Finding[];
  /** Answered yes, but with too little conviction to call it a finding. */
  unsure: Finding[];
  note: string;
  /** The mode that was asked for, which differs when it is not set up yet. */
  asked_for: "rules" | "model" | "jev";
  /** The versioned model that answered, e.g. "jev-1.13.0". */
  model?: string;
  inputTokens: number;
  outputTokens: number;
  /** Only when the price is set, since nothing is assumed. */
  cost?: number;
  /** Requests that failed; their questions went unanswered. */
  failed?: number;
  failure?: string;
}

export interface Source {
  document: string;
  page: number | null;
  block: number;
  piece: string;
}

export interface MadeBy {
  run: string;
  model: string;
  prompt: string;
  attempt: number;
}

export interface Requirement {
  id: string;
  title: string;
  acceptance: string;
  domain: string;
  impacted: string;
  flag: "clear" | "vague";
  clarification: string | null;
  source: Source;
  madeBy: MadeBy;
  editedBy: string[];
  /** Bumped whenever the wording changes in a way that matters. */
  version: number;
  /** What it said when it was read out of the document. */
  asExtracted: Wording | null;
  orphaned: boolean;
}

export interface Estimate {
  documents?: number;
  requirements?: number;
  pieces: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  cost: number | null;
  overBudget: boolean;
  note: string;
}

export interface Run {
  id: string;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "finished" | "stopped" | "failed";
  model: string;
  prompt: string;
  batches: number;
  batchesDone: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  produced: number;
  note: string | null;
  /** Which judgement mode was on while this ran. */
  judge: "rules" | "model" | "jev";
}

export interface Price {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface Scenario {
  id: string;
  reqId: string;
  /** The requirement version this was built from. */
  reqVersion: number;
  title: string;
  class: "Positive" | "Negative" | "Boundary" | "Security" | "Edge";
  priority: "P1" | "P2" | "P3";
  autoFeasibility: "Automatable" | "Partial" | "Manual";
  precondition: string;
  trigger: string;
  expected: string;
  state: "pending" | "approved" | "rejected";
  decidedAt: string | null;
  comment: string | null;
  madeBy: MadeBy;
}

export interface RankedScenario {
  rank: number;
  id: string;
  reqId: string;
  title: string;
  factors: string;
  arithmetic: string;
  score: number;
  band: "P1" | "P2" | "P3";
  cycle: "C1" | "C2";
}

export interface Balance {
  reqId: string;
  scenarios: number;
  hasPositive: boolean;
  hasNegative: boolean;
  note: string | null;
}

/** One judged answer, whoever answered it. */
export interface Judged<T> {
  id: string;
  answer: T;
  confidence: number;
  why: string;
  by: "rules" | "model" | "jev";
}

export interface Judgement<T> {
  answers: Array<Judged<T>>;
  model: string;
  inputTokens: number;
  outputTokens: number;
  failures: string[];
}

export interface Review {
  ranked: { ranked: RankedScenario[]; bands: Record<string, number> };
  balance: Balance[];
  /** Whether each requirement's scenarios are enough, as judged. */
  enough: Judgement<boolean>;
}

/** The fields a case has, in the order the mapping screen offers them. */
export const CASE_FIELDS = [
  "title",
  "steps",
  "expected",
  "precondition",
  "id",
  "priority",
  "caseType",
  "testData",
  "platform",
  "autoFeasibility",
  "description",
  "reqId",
  "scenarioId",
] as const;

export interface ImportPreview {
  columns: string[];
  rows: string[][];
  total: number;
  mapping: Record<string, number>;
  why: Record<string, string>;
  unmapped: string[];
  by: "rules" | "jev";
  /** Fields that must be pointed at a column before importing. */
  missing: string[];
  note: string;
}

export interface Derived {
  scenarios: number;
  rows: number;
  /** How many classes the judge decided rather than the word rule. */
  judged: number;
  note: string;
}

export interface Turn {
  from: "person" | "app";
  text: string;
  at: string;
}

export interface Wording {
  title: string;
  acceptance: string;
}

/** New wording a discussion arrived at. Distinct from the assistant's own
 *  Proposal, which covers the whole project rather than one requirement. */
export interface Rewording extends Wording {
  why: string;
}

export interface Said {
  reply: string;
  /** What it needs to know before it can propose anything. */
  question: string | null;
  proposal: Rewording | null;
  inputTokens: number;
  outputTokens: number;
}

export interface Applied {
  version: number;
  change: "wording" | "sharper" | "different";
  /** False when the new wording drops something the old one covered. */
  keeps: boolean;
  scenariosStale: number;
  casesStale: number;
  approvedStale: number;
  discussion: string;
  note: string;
}

export interface Discussion {
  id: string;
  reqId: string;
  startedAt: string;
  turns: Turn[];
  producedVersion: number | null;
  before: Wording | null;
  after: Wording | null;
  change: string | null;
  model: string;
  prompt: string;
}

export interface PlanStep {
  from: string;
  action: string;
  selector: string | null;
  value: string;
  problem: string | null;
  first: boolean;
}

export interface TestPlan {
  id: string;
  title: string;
  steps: PlanStep[];
  runnable: boolean;
}

export interface StepResult {
  from: string;
  /** passed · failed · skipped */
  state: string;
  ms: number;
  detail: string | null;
}

export interface CaseResult {
  id: string;
  title: string;
  /** passed · failed · unfinished */
  state: string;
  ms: number;
  steps: StepResult[];
  endedAt: string | null;
  detail: string | null;
  /** Where the picture of the failure was written. */
  shot: string | null;
}

export interface Attempt {
  id: string;
  at: string;
  passed: number;
  failed: number;
  unfinished: number;
  ms: number;
  cases: CaseResult[];
}

export interface CodeEstimate {
  cases: number;
  pages: number;
  controls: number;
  model: string | null;
  note: string;
}

export interface CodeLine {
  from: string;
  code: string | null;
  problem: string | null;
  confidence: number;
}

export interface CodeSpec {
  id: string;
  title: string;
  lines: CodeLine[];
  unfinished: number;
  checks: number;
}

export interface Generated {
  path: string;
  runnable: number;
  unfinished: number;
  /** The cases that could not be fully written, and why. */
  gaps: CodeSpec[];
  run: Run;
  note: string;
}

export interface AppElement {
  tag: string;
  role: string | null;
  name: string | null;
  /** testId · role · label · placeholder · text · css */
  how: string;
  selector: string;
  /** How well this selector should survive a redesign, 0 to 1. */
  sturdiness: number;
  /** How many elements it matched, when it was tried. */
  matches: number;
  /** Whether it was tried at all — untried is not the same as broken. */
  checked: boolean;
  /** input · control · link · text */
  kind: string;
}

export interface AppPage {
  url: string;
  title: string;
  fingerprint: string;
  /** The address with its identifiers removed, as in /product/{}. */
  pattern: string;
  /** What the page is made of, with the words left out. */
  shape: string;
  /** Other addresses that turned out to be this same screen. */
  examples: string[];
  elements: AppElement[];
  links: string[];
  from: string | null;
  seenAt: string;
}

export interface Explored {
  pages: number;
  /** Addresses that turned out to be a screen already mapped. */
  repeats: number;
  changed: number;
  fresh: number;
  skipped: string[];
  /** True when all it found was a login page. */
  needsSignIn: boolean;
  note: string;
  run: Run;
}

export interface DriftGap {
  reqId: string;
  document: string;
  page: number | null;
  /** What the document says. */
  paragraph: string;
  /** What the requirement says now. */
  title: string;
  acceptance: string;
  why: string;
  confidence: number;
  edited: boolean;
}

export interface DriftReport {
  gaps: DriftGap[];
  checked: number;
  orphaned: number;
  /** Orphans someone had edited — the ones worth rescuing. */
  orphanedAndEdited: number;
  by: "rules" | "jev";
  note: string;
}

export interface CaseLink {
  reqId: string;
  confidence: number;
  why: string;
}

export interface Imported {
  added: number;
  skipped: number;
  renamed: string[];
  run: Run;
  note: string;
}

export interface TcerRow {
  id: string;
  tcId: string;
  reqId: string;
  /** The requirement version this was built from. */
  reqVersion: number;
  title: string;
  precondition: string;
  trigger: string;
  expected: string;
  priority: string;
  score: number;
  verdict: "Pass" | "Rework" | "Reject" | "";
  reasons: string[];
  removed: boolean;
  comment: string | null;
  madeBy: MadeBy | null;
}

export interface TcerEstimate {
  approved: number;
  complete: number;
  toComplete: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  cost: number | null;
  overBudget: boolean;
  note: string;
}

export interface CoverageLine {
  reqId: string;
  title: string;
  source: string;
  scenarioIds: string[];
  caseIds: string[];
  caseCount: number;
  label: "Covered" | "Partial" | "Gap";
  reason: string;
  rejected: number;
}

export interface RequirementNeed {
  reqId: string;
  casesNow: number;
  casesRequired: number;
  band: "P1" | "P2" | "P3";
  cycle: "C1" | "C2";
}

export interface CoverageReport {
  coverage: {
    lines: CoverageLine[];
    covered: number;
    partial: number;
    gap: number;
    percent: number;
  };
  risk: { ranked: RankedScenario[]; bands: Record<string, number> };
  needs: RequirementNeed[];
}

export interface TestCasePublish {
  publishId: string | null;
  publishTarget: string | null;
  publishedAt: string | null;
}

export interface TestCase extends TestCasePublish {
  id: string;
  scenarioId: string;
  reqId: string;
  /** The requirement version this was written against. */
  reqVersion: number;
  title: string;
  description: string;
  caseType: string;
  priority: string;
  precondition: string;
  testData: string;
  steps: string;
  expected: string;
  platform: string;
  autoFeasibility: string;
  state: "pending" | "approved" | "rework" | "rejected";
  decidedAt: string | null;
  comment: string | null;
  madeBy: MadeBy;
  /** The file it came from, empty when it was written here. */
  importedFrom: string;
}

export interface CasesEstimate {
  rows: number;
  skippedRejected: number;
  skippedRemoved: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  cost: number | null;
  overBudget: boolean;
  note: string;
}

export interface ValidationLine {
  id: string;
  title: string;
  issues: string[];
  score: number;
  verdict: "Pass" | "Rework" | "Reject";
}

export interface ValidationReport {
  lines: ValidationLine[];
  pass: number;
  rework: number;
  reject: number;
}

export interface BddCase {
  id: string;
  caseId: string;
  reqId: string;
  feature: string;
  title: string;
  given: string;
  when: string;
  then: string;
  examples: string;
  testData: string;
  platform: string;
  priority: string;
  newSteps: string[];
  madeBy: MadeBy;
}

export interface BddEstimate {
  cases: number;
  batches: number;
  library: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  cost: number | null;
  overBudget: boolean;
  note: string;
}

export interface Suite {
  id: string;
  name: string;
  purpose: string;
  cases: string[];
}

export interface FeasibilityLine {
  id: string;
  title: string;
  automation: "Automatable" | "Partial" | "Manual";
  tool: string;
  value: "High" | "Medium" | "Low";
  why: string;
}

export interface FeasibilityReport {
  lines: FeasibilityLine[];
  automatable: number;
  partial: number;
  manual: number;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  changed: number;
  contextChanged: number;
  hasRemote: boolean;
}

export interface GitResult {
  committed: boolean;
  pushed: boolean;
  detail: string;
}

export interface Delta {
  firstRun: boolean;
  unchangedPieces: number;
  newPieces: number;
  gonePieces: number;
  keep: number;
  orphaned: number;
  estimate: Estimate;
  note: string;
}

export interface DesignPlan {
  requirements: number;
  withScenarios: number;
  toDesign: number;
  orphaned: number;
}

export interface Proposal {
  action: string;
  ids: string[];
  verdict?: string;
  title?: string;
  acceptance?: string;
  flag?: string;
  why: string;
}

export interface AssistantAnswer {
  answer: string;
  proposal: Proposal | null;
  destructive: boolean;
  contextNote: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Summary {
  documents: number;
  requirements: number;
  vague: number;
  orphaned: number;
  scenarios: number;
  pendingGateA: number;
  approvedScenarios: number;
  rows: number;
  cases: number;
  pendingGateB: number;
  approvedCases: number;
  published: number;
  bdd: number;
  steps: number;
  decisions: number;
}

export interface Commands {
  project_summary: { args: { projectPath: string }; result: Summary };
  project_edit: { args: { path: string; name: string; appUrl: string }; result: OpenProject };
  assistant_ask: {
    args: {
      projectPath: string;
      question: string;
      history: Array<{ question: string; answer: string }>;
    };
    result: AssistantAnswer;
  };
  assistant_apply: { args: { projectPath: string; proposal: Proposal }; result: string };
  assistant_undo: { args: { projectPath: string }; result: string };
  extract_plan: { args: { projectPath: string }; result: Delta };
  requirements_drop_orphans: {
    args: { projectPath: string; includeEdited: boolean };
    result: number;
  };
  requirement_discuss: {
    args: { projectPath: string; reqId: string; said: string; history: Turn[] };
    result: Said;
  };
  requirement_apply_wording: {
    args: {
      projectPath: string;
      reqId: string;
      title: string;
      acceptance: string;
      turns: Turn[];
    };
    result: Applied;
  };
  requirement_keep_discussion: {
    args: { projectPath: string; reqId: string; turns: Turn[] };
    result: string;
  };
  requirement_discussions: { args: { projectPath: string; reqId: string }; result: Discussion[] };
  tests_run: {
    args: { projectPath: string; only: string | null; watch: boolean };
    result: Attempt;
  };
  tests_history: { args: { projectPath: string }; result: Attempt[] };
  plan_list: { args: { projectPath: string }; result: TestPlan[] };
  code_estimate: { args: { projectPath: string }; result: CodeEstimate };
  code_run: { args: { projectPath: string }; result: Generated };
  explore_run: {
    args: { projectPath: string; pages: number; depth: number; freshStart: boolean };
    result: Explored;
  };
  explore_map: { args: { projectPath: string }; result: AppPage[] };
  sign_in_set: {
    args: {
      projectPath: string;
      username: string;
      password: string;
      submit: string;
      user: string;
      secret: string;
    };
    result: null;
  };
  sign_in_clear: { args: { projectPath: string }; result: null };
  document_drift: { args: { projectPath: string }; result: DriftReport };
  document_drift_export: { args: { projectPath: string }; result: string };
  design_plan: { args: { projectPath: string }; result: DesignPlan };
  bdd_estimate: { args: { projectPath: string }; result: BddEstimate };
  bdd_run: { args: { projectPath: string }; result: Run };
  bdd_list: { args: { projectPath: string }; result: BddCase[] };
  steps_list: { args: { projectPath: string }; result: string[] };
  case_decide: {
    args: { projectPath: string; ids: string[]; verdict: string; comment?: string };
    result: number;
  };
  suite_list: { args: { projectPath: string }; result: Suite[] };
  suite_toggle: { args: { projectPath: string; suiteId: string; caseId: string }; result: Suite };
  suite_fill_from_risk: {
    args: { projectPath: string; suiteId: string; band: string };
    result: Suite;
  };
  publish_run: {
    args: { projectPath: string; target: string };
    result: { published: number; target: string; file: string };
  };
  feasibility_get: { args: { projectPath: string }; result: FeasibilityReport };
  git_status: { args: { projectPath: string }; result: GitStatus };
  git_commit: {
    args: { projectPath: string; message: string; includeContext: boolean; push: boolean };
    result: GitResult;
  };
  cases_estimate: { args: { projectPath: string }; result: CasesEstimate };
  cases_run: { args: { projectPath: string }; result: Run };
  case_list: { args: { projectPath: string }; result: TestCase[] };
  cases_import_preview: {
    args: { projectPath: string; sourcePath: string };
    result: ImportPreview;
  };
  cases_import: {
    args: { projectPath: string; sourcePath: string; mapping: Record<string, number> };
    result: Imported;
  };
  cases_link_propose: { args: { projectPath: string }; result: Judgement<CaseLink | null> };
  cases_link_apply: {
    args: { projectPath: string; links: Array<[string, string]> };
    result: number;
  };
  cases_derive_spine: { args: { projectPath: string }; result: Derived };
  cases_validate: { args: { projectPath: string }; result: ValidationReport };
  cases_verify: { args: { projectPath: string }; result: Judgement<boolean> };
  tcer_estimate: { args: { projectPath: string }; result: TcerEstimate };
  tcer_run: { args: { projectPath: string }; result: Run };
  tcer_list: { args: { projectPath: string }; result: TcerRow[] };
  tcer_amend: {
    args: { projectPath: string; tcId: string; removed?: boolean; comment?: string };
    result: TcerRow[];
  };
  coverage_get: { args: { projectPath: string }; result: CoverageReport };
  design_estimate: { args: { projectPath: string }; result: Estimate };
  design_run: { args: { projectPath: string; delta: boolean }; result: Run };
  scenario_list: { args: { projectPath: string }; result: Scenario[] };
  scenario_decide: {
    args: { projectPath: string; ids: string[]; verdict: string; comment?: string };
    result: number;
  };
  scenario_review: { args: { projectPath: string }; result: Review };
  extract_estimate: { args: { projectPath: string }; result: Estimate };
  extract_run: { args: { projectPath: string; delta: boolean }; result: Run };
  extract_cancel: { args: Record<string, never>; result: null };
  requirement_list: { args: { projectPath: string }; result: Requirement[] };
  run_list: { args: { projectPath: string }; result: Run[] };
  requirements_export: { args: { projectPath: string }; result: string };
  price_set: {
    args: { model: string; inputPerMillion: number; outputPerMillion: number };
    result: null;
  };
  settings_get: { args: Record<string, never>; result: Settings };
  project_remove: {
    args: { path: string; deleteFiles: boolean };
    result: { trashed: string | null; note: string };
  };
  judge_state: { args: { projectPath: string }; result: JudgeState };
  judge_set_mode: { args: { projectPath: string; mode: string }; result: null };
  judge_review: { args: { projectPath: string }; result: Review };
  jev_set_model: { args: { model: string }; result: null };
  assignment_set: { args: { job: string; model: string }; result: null };
  budgets_set: { args: { perRun: number; monthly: number; maxParallel: number }; result: null };
  models_list: { args: { provider: string }; result: ModelSummary[] };
  model_self_test: { args: { model: string; contextWindow?: number }; result: SelfTest };
  document_add: { args: { projectPath: string; sourcePath: string }; result: DocumentAdded };
  document_list: { args: { projectPath: string }; result: DocumentRecord[] };
  document_chunks: {
    args: { projectPath: string; documentId: string; limit: number };
    result: Chunk[];
  };
  project_list: { args: Record<string, never>; result: ProjectRef[] };
  project_create: { args: { name: string; appUrl: string; folder?: string }; result: OpenProject };
  project_open: { args: { path: string }; result: OpenProject };
  project_last: { args: Record<string, never>; result: OpenProject | null };
  core_info: { args: Record<string, never>; result: CoreInfo };
  worker_status: { args: Record<string, never>; result: WorkerStatus };
  worker_ping: { args: Record<string, never>; result: WorkerPong };
  worker_crash: { args: Record<string, never>; result: { crashing: boolean } };
  start_demo_job: { args: Record<string, never>; result: { jobId: string } };
  cancel_job: { args: { jobId: string }; result: { cancelled: boolean } };
  provider_list: { args: Record<string, never>; result: ProviderStatus[] };
  provider_set_key: { args: { provider: string; key: string }; result: null };
  provider_clear_key: { args: { provider: string }; result: null };
  provider_set_endpoint: { args: { provider: string; endpoint: string }; result: null };
  provider_validate: { args: { provider: string }; result: ValidationResult };
}

export type CommandName = keyof Commands;

/** Events pushed from the core, including everything forwarded from the worker. */
export interface Events {
  "run:progress": { runId: string; done: number; total: number; found: number; cost: number | null };
  "run:requirement": Requirement;
  "run:scenario": Scenario;
  "run:case": TestCase;
  "run:problem": { batch: number; detail: string };
  "run:finished": Run;
  "worker:status": WorkerStatus;
  "worker:log": { line: string };
  "worker:hello": { pid: number; node: string };
  "job:event": JobEvent;
}

export interface JobEvent {
  jobId: string;
  kind: "started" | "step" | "finished" | "failed" | "cancelled";
  step?: number;
  totalSteps?: number;
  label?: string;
  ts: number;
}

export type EventName = keyof Events;
