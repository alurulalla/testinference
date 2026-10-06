import { discuss as askAgent } from "../agents/discuss.js";
import { change as judgeChange } from "../decisions/ask.js";
import { read as readChunks } from "../store/chunks.js";
import { record as recordDecision } from "../store/decisions.js";
import * as store from "../store/index.js";
import { readContext } from "../store/project.js";
import { endpointFor, load as loadSettings } from "../store/settings.js";
import { judgeSettings } from "./judge.js";
import { keyFor, providerOf } from "./keys.js";

/**
 * Talking a requirement into shape.
 *
 * Two rules hold this together. Nothing is applied without a person
 * seeing the before and the after. And when wording does change,
 * everything built from the old wording is marked rather than deleted or
 * quietly kept — a test approved against "search should be fast" was
 * approved against a sentence that no longer exists, and the record has
 * to say so.
 */

/** How many of a requirement's tests are named for the discussion. */
const NAMED = 25;

function builtOn(projectPath: string, reqId: string) {
  const scenarios = store.scenarios.list(projectPath).filter((item) => item.reqId === reqId);
  const cases = store.cases.list(projectPath).filter((item) => item.reqId === reqId);
  return {
    scenarios: scenarios.length,
    cases: cases.length,
    approved: cases.filter((item) => item.state === "approved").length,
    // The titles matter: without them the discussion says it cannot see
    // the test suite, which is not true — it is in the same folder.
    titles: cases.slice(0, NAMED).map((item) => `${item.id} (${item.state}): ${item.title}`),
  };
}

/** The paragraph a requirement was read from, if it is still anywhere. */
function paragraphFor(projectPath: string, piece: string): string {
  const context = readContext(projectPath);
  for (const document of store.documents.list(projectPath)) {
    for (const chunk of readChunks(context.id, document.id)) {
      if (chunk.hash === piece) return chunk.text;
    }
  }
  return "";
}

export interface Said {
  reply: string;
  question: string | null;
  proposal: { title: string; acceptance: string; why: string } | null;
  inputTokens: number;
  outputTokens: number;
}

export async function send(
  projectPath: string,
  reqId: string,
  said: string,
  history: unknown,
): Promise<Said> {
  const requirement = store.requirements.get(projectPath, reqId);
  if (!requirement) throw new Error(`there is no requirement called ${reqId}`);

  const settings = loadSettings();
  const model = settings.assignments["summarise"] ?? settings.assignments["read-documents"];
  if (!model) {
    throw new Error("assign a model to summaries in Settings — a discussion needs one");
  }
  const provider = providerOf(model);

  const answer = (await askAgent({
    model,
    key: keyFor(provider),
    endpoint: endpointFor(provider, settings),
    said,
    history,
    requirement: {
      id: requirement.id,
      title: requirement.title,
      acceptance: requirement.acceptance,
      flag: requirement.flag,
      clarification: requirement.clarification,
      paragraph: paragraphFor(projectPath, requirement.source.piece),
    },
    built: builtOn(projectPath, reqId),
  })) as Said & Record<string, unknown>;

  return {
    reply: answer.reply,
    question: answer.question ?? null,
    proposal: answer.proposal ?? null,
    inputTokens: Number(answer["inputTokens"] ?? 0),
    outputTokens: Number(answer["outputTokens"] ?? 0),
  };
}

export interface Applied {
  version: number;
  change: string;
  keeps: boolean;
  scenariosStale: number;
  casesStale: number;
  approvedStale: number;
  discussion: string;
  note: string;
}

export async function apply(
  projectPath: string,
  reqId: string,
  title: string,
  acceptance: string,
  turns: store.Turn[],
): Promise<Applied> {
  const requirement = store.requirements.get(projectPath, reqId);
  if (!requirement) throw new Error(`there is no requirement called ${reqId}`);
  if (!title.trim()) throw new Error("a requirement needs a title");

  const before: store.Wording = {
    title: requirement.title,
    acceptance: requirement.acceptance,
  };
  const after: store.Wording = { title: title.trim(), acceptance: acceptance.trim() };
  if (before.title === after.title && before.acceptance === after.acceptance) {
    throw new Error("that is what it already says");
  }

  // How far has it moved, and did anything fall out of it?
  const verdict = await judgeChange({ ...judgeSettings(projectPath), before, after });
  const kind = verdict.answer.kind;
  const keeps = verdict.answer.keeps;

  // A typo does not make eleven test cases suspect.
  const version = kind === "wording" ? requirement.version : requirement.version + 1;

  store.requirements.save(projectPath, {
    ...requirement,
    title: after.title,
    acceptance: after.acceptance,
    version,
    // Wording that can be tested is no longer flagged as vague, and the
    // question asked about it has been answered.
    flag: after.acceptance ? "clear" : requirement.flag,
    clarification: after.acceptance ? null : requirement.clarification,
    asExtracted: requirement.asExtracted ?? before,
    editedBy: [...requirement.editedBy, `discussed ${store.now()}`],
  });

  // A person changing a requirement's wording is a decision, and it was
  // the one human act that never reached the decision log.
  recordDecision(projectPath, {
    at: store.now(),
    gate: "requirements",
    subject: reqId,
    verdict: `reworded · ${kind}`,
    comment: `was: ${before.title} — ${before.acceptance || "no acceptance"}`,
    title: after.title,
  });

  // Nothing is rewritten downstream. What was built from the old
  // wording keeps saying so, and the screens compare the two numbers.
  const scenariosStale = store.scenarios
    .list(projectPath)
    .filter((item) => item.reqId === reqId && item.reqVersion < version).length;
  const staleCases = store.cases
    .list(projectPath)
    .filter((item) => item.reqId === reqId && item.reqVersion < version);
  const approvedStale = staleCases.filter((item) => item.state === "approved").length;

  const id = `talk-${String(store.discussions.count(projectPath) + 1).padStart(3, "0")}`;
  store.discussions.save(projectPath, {
    id,
    reqId,
    startedAt: store.now(),
    turns,
    producedVersion: version,
    before,
    after,
    change: kind,
    model: "discussed",
    prompt: "discuss@v1",
    inputTokens: 0,
    outputTokens: 0,
  });

  const total = builtOn(projectPath, reqId);
  let note: string;
  if (total.scenarios === 0 && total.cases === 0) {
    note =
      requirement.flag === "clear" || after.acceptance
        ? "Nothing has been designed from this requirement yet. Now that it is testable, Test Design → Scenarios will pick it up."
        : "Nothing has been designed from this requirement yet, and it is still flagged vague, so designing will skip it.";
  } else if (kind === "wording") {
    note = "Only the wording changed, so nothing built on this was disturbed.";
  } else if (kind === "sharper") {
    note = `This says the same thing more precisely. The ${scenariosStale} scenarios and ${staleCases.length} cases written from the older wording are still valid, but may no longer be enough.`;
  } else {
    note = `This asks for something different. ${scenariosStale} scenarios and ${staleCases.length} cases were written from the older wording.`;
  }
  if (!keeps) note = `${note} Careful: the new wording appears to drop something the old one covered.`;

  return {
    version,
    change: kind,
    keeps,
    scenariosStale,
    casesStale: staleCases.length,
    approvedStale,
    discussion: id,
    note,
  };
}

/**
 * Records a discussion that changed nothing. Someone looked at this and
 * was satisfied, which is worth as much as a change.
 */
export function keep(projectPath: string, reqId: string, turns: store.Turn[]): string {
  const id = `talk-${String(store.discussions.count(projectPath) + 1).padStart(3, "0")}`;
  store.discussions.save(projectPath, {
    id,
    reqId,
    startedAt: store.now(),
    turns,
    producedVersion: null,
    before: null,
    after: null,
    change: null,
    model: "discussed",
    prompt: "discuss@v1",
    inputTokens: 0,
    outputTokens: 0,
  });
  return id;
}

export function forRequirement(projectPath: string, reqId: string): store.Discussion[] {
  return store.discussions.list(projectPath).filter((item) => item.reqId === reqId);
}
