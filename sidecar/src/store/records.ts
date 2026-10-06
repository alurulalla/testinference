/**
 * Every record the app keeps, defined once.
 *
 * Once is the point. These shapes used to exist twice — a Rust struct and
 * a TypeScript interface — and the two drifted: a field added on one side
 * and not the other made every explored page fail to parse and vanish
 * without a word. One definition cannot drift from itself.
 */

/** Where a requirement came from, down to the piece of the document. */
export interface Source {
  document: string;
  page: number | null;
  block: number;
  piece: string;
}

/** What produced an artifact. Without it, "why did this change?" has no answer. */
export interface MadeBy {
  run: string;
  model: string;
  prompt: string;
  attempt: number;
}

/** A requirement's wording at one point in its life. */
export interface Wording {
  title: string;
  acceptance: string;
}

export interface Requirement {
  id: string;
  title: string;
  acceptance: string;
  domain: string;
  impacted: string;
  /** "clear" or "vague" — one controlled word, not a free-text label. */
  flag: string;
  /** Bumped whenever the wording changes in a way that matters. */
  version: number;
  /** What it said when it was read out of the document. */
  asExtracted: Wording | null;
  clarification: string | null;
  source: Source;
  madeBy: MadeBy;
  editedBy: string[];
  /** True when the piece it came from has gone. Kept, never deleted. */
  orphaned: boolean;
}

export interface Scenario {
  id: string;
  reqId: string;
  /** The requirement version this was designed from. */
  reqVersion: number;
  title: string;
  class: string;
  priority: string;
  autoFeasibility: string;
  precondition: string;
  trigger: string;
  expected: string;
  /** pending · approved · rejected */
  state: string;
  decidedAt: string | null;
  comment: string | null;
  madeBy: MadeBy;
}

export interface TcerRow {
  id: string;
  tcId: string;
  reqId: string;
  reqVersion: number;
  title: string;
  precondition: string;
  trigger: string;
  expected: string;
  priority: string;
  score: number;
  verdict: string;
  reasons: string[];
  removed: boolean;
  comment: string | null;
  madeBy: MadeBy | null;
}

export interface TestCase {
  id: string;
  scenarioId: string;
  reqId: string;
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
  /** pending · approved · rework · rejected */
  state: string;
  decidedAt: string | null;
  comment: string | null;
  madeBy: MadeBy;
  /** The file it was imported from, empty when written here. */
  importedFrom: string;
  publishId: string | null;
  publishTarget: string | null;
  publishedAt: string | null;
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

export interface Suite {
  id: string;
  name: string;
  purpose: string;
  cases: string[];
}

export interface Run {
  id: string;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  /** running · finished · stopped · failed */
  status: string;
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
  judge: string;
  /** Fingerprints of the document pieces this run read. */
  pieces: string[];
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

/** A control on a page, and how a test would find it again. */
export interface AppElement {
  tag: string;
  role: string | null;
  name: string | null;
  /** testId · role · label · placeholder · text · css */
  how: string;
  selector: string;
  /** How well it should survive a redesign, 0 to 1. */
  sturdiness: number;
  /** How many elements it matched, when it was tried. */
  matches: number;
  /** Whether it was tried at all — untried is not the same as broken. */
  checked: boolean;
  /** input · control · link · text */
  kind: string;
}

export interface AppPage {
  /** The address is the identity here, and also the id. */
  id: string;
  url: string;
  title: string;
  fingerprint: string;
  /** The address with its identifiers removed: /product/{}. */
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

export interface PlanStep {
  from: string;
  action: string;
  selector: string | null;
  value: string;
  problem: string | null;
  first: boolean;
}

export interface Plan {
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
  /** Where the picture of the failure was written, outside the project. */
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

/** A conversation about one requirement, kept with the project. */
export interface Turn {
  from: string;
  text: string;
  at: string;
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
  inputTokens: number;
  outputTokens: number;
}

/** The default every optional field takes when a file predates it. */
export const DEFAULTS = {
  requirement: { version: 1, asExtracted: null, editedBy: [], orphaned: false, domain: "", impacted: "" },
  scenario: { reqVersion: 1, decidedAt: null, comment: null },
  tcerRow: { reqVersion: 1, reasons: [], removed: false, comment: null, madeBy: null },
  testCase: {
    reqVersion: 1,
    description: "",
    precondition: "",
    testData: "",
    steps: "",
    expected: "",
    platform: "",
    autoFeasibility: "",
    decidedAt: null,
    comment: null,
    importedFrom: "",
    publishId: null,
    publishTarget: null,
    publishedAt: null,
  },
  run: { judge: "rules", pieces: [], note: null, cost: null, finishedAt: null },
  appPage: { pattern: "", shape: "", examples: [], links: [], seenAt: "", from: null },
  discussion: { producedVersion: null, before: null, after: null, change: null, inputTokens: 0, outputTokens: 0 },
};

/** The moment, written the one way every record writes it. */
export function now(): string {
  return new Date().toISOString();
}
