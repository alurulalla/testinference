import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { ask as askAgent } from "../agents/assistant.js";
import { gateAction } from "../decisions/ask.js";
import { record as recordDecision } from "../store/decisions.js";
import * as store from "../store/index.js";
import { atomicWrite, contextDir } from "../store/paths.js";
import { endpointFor, load as loadSettings } from "../store/settings.js";
import { decideScenarios } from "./gates.js";
import { judgeSettings } from "./judge.js";
import { keyFor, providerOf } from "./keys.js";

/**
 * The assistant: context in, answer out, and a proposal a person applies.
 *
 * Two things make this safe enough to ship. The context is selected
 * rather than dumped, and the screen is told what was left out. And
 * nothing the model returns is applied here — applying is a separate
 * step, after a person has read the proposal, with the previous values
 * saved so it can be undone.
 */

/** How many records of each kind go into the context. */
const SLICE = 40;

/**
 * Picks the records worth showing for this question, and says what was
 * left out.
 *
 * Records the question names come first, then the rest, without
 * repeats. The Rust version collected these through a sorted set, which
 * quietly discarded that order: the first forty alphabetically went in,
 * so a question about REQ-116 among 144 could be answered without ever
 * seeing REQ-116.
 */
export function contextFor(projectPath: string, question: string): { context: string; note: string } {
  const words = new Set(
    question
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 3),
  );
  const mentions = (text: string): boolean => {
    const lowered = text.toLowerCase();
    return [...words].some((word) => lowered.includes(word));
  };

  const requirements = store.requirements.list(projectPath);
  const scenarios = store.scenarios.list(projectPath);
  const cases = store.cases.list(projectPath);
  const rows = store.tcer.list(projectPath);

  const pick = <T>(
    items: T[],
    relevant: (item: T) => boolean,
    line: (item: T) => string,
  ): { lines: string[]; left: number } => {
    const first = words.size === 0 ? [] : items.filter(relevant);
    const ordered = [...new Set([...first, ...items].map(line))];
    const shown = ordered.slice(0, SLICE);
    return { lines: shown, left: items.length - shown.length };
  };

  const picked = {
    requirements: pick(
      requirements,
      (item) => mentions(item.id) || mentions(item.title),
      (item) => `${item.id} [${item.flag}] ${item.title} — ${item.acceptance}`,
    ),
    scenarios: pick(
      scenarios,
      (item) => mentions(item.id) || mentions(item.title),
      (item) => `${item.id} [${item.state} ${item.class} ${item.priority}] ${item.title} (from ${item.reqId})`,
    ),
    cases: pick(
      cases,
      (item) => mentions(item.id) || mentions(item.title),
      (item) => `${item.id} [${item.state}] ${item.title} (from ${item.reqId})`,
    ),
  };

  const context = [
    `Counts: ${requirements.length} requirements, ${scenarios.length} scenarios, ${rows.length} rows, ${cases.length} test cases.`,
    "",
    "REQUIREMENTS",
    picked.requirements.lines.join("\n"),
    "",
    "SCENARIOS",
    picked.scenarios.lines.join("\n"),
    "",
    "TEST CASES",
    picked.cases.lines.join("\n"),
  ].join("\n");

  const leftOut = picked.requirements.left + picked.scenarios.left + picked.cases.left;
  const note =
    leftOut === 0
      ? "it saw everything in this project"
      : `it saw ${picked.requirements.lines.length} requirements, ${picked.scenarios.lines.length} scenarios and ${picked.cases.lines.length} cases — ${leftOut} records were left out, so ask about them by name if you need them`;

  return { context, note };
}

export interface Answer {
  answer: string;
  proposal: Record<string, unknown> | null;
  destructive: boolean;
  contextNote: string;
  inputTokens: number;
  outputTokens: number;
}

/** Actions that always need confirming. A judge can add to this list, never remove from it. */
const ALWAYS_CONFIRM = new Set(["delete_requirements", "remove_tcer"]);

export async function ask(projectPath: string, question: string, history: unknown): Promise<Answer> {
  const settings = loadSettings();
  const model = settings.assignments["summarise"] ?? settings.assignments["read-documents"];
  if (!model) throw new Error("assign a model to summaries first");

  const provider = providerOf(model);
  const { context, note } = contextFor(projectPath, question);

  const answer = (await askAgent({
    model,
    key: keyFor(provider),
    endpoint: endpointFor(provider, settings),
    question,
    context,
    history,
  })) as unknown as Record<string, unknown>;

  const proposal = (answer["proposal"] as Record<string, unknown> | null | undefined) ?? null;
  const action = typeof proposal?.["action"] === "string" ? proposal["action"] : "";

  // The list of actions that always need confirming is never overruled.
  // A judge can only add to it: an action whose name looks harmless but
  // whose effect, in this request, would throw work away.
  const known = ALWAYS_CONFIRM.has(action);
  let destructive = known;
  if (!known && action !== "") {
    try {
      const verdict = await gateAction({
        ...judgeSettings(projectPath),
        action,
        message: question,
        known: false,
      });
      destructive = verdict.answer;
    } catch {
      // A judge that cannot be reached does not get to wave it through.
      destructive = known;
    }
  }

  return {
    answer: typeof answer["answer"] === "string" ? answer["answer"] : "no answer came back",
    proposal,
    destructive,
    contextNote: note,
    inputTokens: Number(answer["inputTokens"] ?? 0),
    outputTokens: Number(answer["outputTokens"] ?? 0),
  };
}

interface Undo {
  at: string;
  action: string;
  requirements: store.Requirement[];
  scenarios: store.Scenario[];
  cases: store.TestCase[];
  tcer: store.TcerRow[];
}

function undoFile(projectPath: string): string {
  return join(contextDir(projectPath), ".undo.json");
}

export function apply(projectPath: string, proposal: Record<string, unknown>): string {
  const action = proposal["action"];
  if (typeof action !== "string") throw new Error("that proposal has no action");

  const ids = Array.isArray(proposal["ids"])
    ? proposal["ids"].filter((id): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) throw new Error("that proposal names nothing to change");

  const text = (field: string): string | null =>
    typeof proposal[field] === "string" ? (proposal[field] as string) : null;

  // Everything the change touches, saved first so it can be put back.
  const undo: Undo = {
    at: store.now(),
    action,
    requirements: store.requirements.list(projectPath).filter((item) => ids.includes(item.id)),
    scenarios: store.scenarios.list(projectPath).filter((item) => ids.includes(item.id)),
    cases: store.cases.list(projectPath).filter((item) => ids.includes(item.id)),
    tcer: store.tcer.list(projectPath).filter((item) => ids.includes(item.tcId)),
  };
  atomicWrite(undoFile(projectPath), JSON.stringify(undo, null, 2));

  let changed = 0;
  switch (action) {
    case "update_requirement":
      for (const id of ids) {
        const requirement = store.requirements.get(projectPath, id);
        if (!requirement) continue;

        const flag = text("flag");
        store.requirements.save(projectPath, {
          ...requirement,
          title: text("title") ?? requirement.title,
          acceptance: text("acceptance") ?? requirement.acceptance,
          flag: flag === "clear" || flag === "vague" ? flag : requirement.flag,
          editedBy: [...requirement.editedBy, `assistant ${store.now()}`],
        });
        changed += 1;
      }
      break;

    case "delete_requirements":
      for (const id of ids) {
        store.requirements.remove(projectPath, id);
        changed += 1;
      }
      break;

    case "decide_scenarios":
      changed = decideScenarios(
        projectPath,
        ids,
        text("verdict") ?? "approved",
        "by the assistant, with your approval",
      );
      break;

    case "decide_cases":
      for (const id of ids) {
        const item = store.cases.get(projectPath, id);
        if (!item) continue;
        store.cases.save(projectPath, {
          ...item,
          state: text("verdict") ?? "approved",
          decidedAt: store.now(),
          comment: "by the assistant, with your approval",
        });
        changed += 1;
      }
      break;

    case "remove_tcer":
      for (const id of ids) {
        const row = store.tcer.list(projectPath).find((entry) => entry.tcId === id);
        if (!row) continue;
        store.tcer.save(projectPath, { ...row, removed: true });
        changed += 1;
      }
      break;

    default:
      throw new Error(`${action} is not something the assistant can do`);
  }

  recordDecision(projectPath, {
    at: store.now(),
    gate: "assistant",
    subject: ids.join(", "),
    verdict: action,
    comment: text("why"),
    title: null,
  });

  return `${changed} changed — undo is available until the next change`;
}

export function undo(projectPath: string): string {
  const file = undoFile(projectPath);
  if (!existsSync(file)) throw new Error("there is nothing to undo");

  const saved = JSON.parse(readFileSync(file, "utf8")) as Undo;
  for (const item of saved.requirements) store.requirements.save(projectPath, item);
  for (const item of saved.scenarios) store.scenarios.save(projectPath, item);
  for (const item of saved.cases) store.cases.save(projectPath, item);
  for (const item of saved.tcer) store.tcer.save(projectPath, item);

  const count =
    saved.requirements.length + saved.scenarios.length + saved.cases.length + saved.tcer.length;
  rmSync(file, { force: true });

  recordDecision(projectPath, {
    at: store.now(),
    gate: "assistant",
    subject: saved.action,
    verdict: "undone",
    comment: null,
    title: null,
  });

  return `put back ${count} records from before ${saved.at}`;
}
