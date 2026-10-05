import { complete } from "../models/index.js";
import { normalise } from "../engines/steps.js";
import { isYes, type Noul } from "./jev.js";
import { fanOut, field } from "./fanout.js";

/**
 * The judgement layer.
 *
 * Nine small questions run through here: is this requirement too vague, have
 * we seen it before, what class is this scenario, does this case test what it
 * claims. They are typed questions with typed answers and a confidence, never
 * free prose.
 *
 * Three backends answer them. "rules" is plain code and costs nothing.
 * "model" asks whichever model is assigned to judging. "jev" is the seat kept
 * for Jev itself — it speaks the same OpenAI-shaped protocol until its own is
 * known, so swapping it in is a configuration change rather than a rewrite.
 */

export type Mode = "rules" | "model" | "jev";

export interface Verdict<T> {
  answer: T;
  /** 0 to 1. The caller decides what is high enough to act on. */
  confidence: number;
  why: string;
  by: Mode;
}

/** Words that promise a measurement and never give one. */
const WOOLLY = [
  "fast", "quick", "slow", "acceptable", "reasonable", "appropriate", "efficient",
  "user-friendly", "intuitive", "robust", "scalable", "secure", "as needed",
  "if necessary", "etc", "and so on", "properly", "correctly", "adequate",
];

const HAS_NUMBER = /\d/;

/** Rules: a requirement is vague when it promises a measure and gives none. */
export function judgeVagueByRule(title: string, acceptance: string): Verdict<boolean> {
  const text = `${title} ${acceptance}`.toLowerCase();
  const found = WOOLLY.filter((word) => text.includes(word));

  if (found.length > 0 && !HAS_NUMBER.test(text)) {
    return {
      answer: true,
      confidence: 0.8,
      why: `says "${found[0]}" without a number to test against`,
      by: "rules",
    };
  }
  if (found.length > 0) {
    return {
      answer: false,
      confidence: 0.5,
      why: `says "${found[0]}", but there is a number to test against`,
      by: "rules",
    };
  }
  if (acceptance.trim().length < 12) {
    return { answer: true, confidence: 0.6, why: "the acceptance is too short to test", by: "rules" };
  }
  return { answer: false, confidence: 0.7, why: "states something checkable", by: "rules" };
}

/** Rules: two requirements are the same when their wording mostly overlaps. */
export function judgeSameByRule(left: string, right: string): Verdict<boolean> {
  const a = new Set(normalise(left).split(" ").filter((word) => word.length > 3));
  const b = new Set(normalise(right).split(" ").filter((word) => word.length > 3));
  if (a.size === 0 || b.size === 0) {
    return { answer: false, confidence: 0.3, why: "too little wording to compare", by: "rules" };
  }

  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;

  // Two measures, because one alone misleads. Containment catches the same
  // requirement said with extra words; overlap stops a short requirement
  // matching every longer one that happens to contain it.
  const containment = shared / Math.min(a.size, b.size);
  const overlap = shared / (a.size + b.size - shared);

  return {
    answer: containment >= 0.75 && overlap >= 0.45,
    confidence: Math.min(0.95, 0.4 + overlap / 2),
    why: `${Math.round(containment * 100)}% of the shorter one's wording appears in the other`,
    by: "rules",
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          yes: { type: "boolean" },
          confidence: { type: "number", description: "between 0 and 1" },
          why: { type: "string", description: "one short clause" },
        },
        required: ["id", "yes", "confidence", "why"],
      },
    },
  },
  required: ["answers"],
} as const;

export interface Question {
  id: string;
  ask: string;
}

/**
 * One request, many typed questions — the thing a judgement model is for.
 * Asking twenty questions in one call is what keeps this affordable.
 */
export async function judgeByModel(params: Record<string, unknown>): Promise<Array<Verdict<boolean> & { id: string }>> {
  const model = String(params["model"] ?? "");
  const questions = (params["questions"] ?? []) as Question[];
  const mode = (params["mode"] ?? "model") as Mode;
  const key = typeof params["key"] === "string" ? params["key"] : null;
  const endpoint = typeof params["endpoint"] === "string" ? params["endpoint"] : null;

  if (questions.length === 0) return [];

  const answer = await complete({
    model,
    key,
    endpoint,
    request: {
      messages: [
        {
          role: "system",
          content:
            "Answer each question yes or no, with a confidence between 0 and 1 and one short clause saying why. Be strict: say no when you are not sure, and let the confidence show it. Answer every question you are given, using its id.",
        },
        { role: "user", content: questions.map((q) => `${q.id}: ${q.ask}`).join("\n") },
      ],
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 2048,
    },
  });

  const list = (answer.data as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(list)) throw new Error("the judge did not answer in the shape asked for");

  return list
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      id: String(entry["id"] ?? ""),
      answer: Boolean(entry["yes"]),
      confidence: Math.max(0, Math.min(1, Number(entry["confidence"]) || 0)),
      why: String(entry["why"] ?? ""),
      by: mode,
    }));
}

/** Where a verdict goes: act on it, check it, or hand it to a person. */
export function gate(confidence: number, consequential: boolean): "act" | "verify" | "ask" {
  const high = consequential ? 0.9 : 0.75;
  const low = consequential ? 0.7 : 0.5;
  if (confidence >= high) return "act";
  if (confidence >= low) return "verify";
  return "ask";
}

export interface Item {
  id: string;
  title: string;
  acceptance: string;
}

export interface Finding {
  kind: "vague" | "duplicate";
  id: string;
  other: string | null;
  confidence: number;
  why: string;
  /** act · verify · ask — what the confidence earns. */
  action: "act" | "verify" | "ask";
  by: Mode;
}

/**
 * How much wording two requirements must share before the pair is worth
 * comparing properly. Every pair is every pair — a hundred requirements is
 * five thousand of them — so something has to narrow the field.
 *
 * The two numbers were measured, not chosen. On a real 120-requirement
 * project, dropping the cut from 0.5 to 0.35 took the pairs Jev sees from
 * 200 to 660 and found two more genuine duplicates that share meaning but
 * little wording ("problem_user experiences broken sort functionality" and
 * "Product sorting does not function when logged in as problem_user").
 * Below 0.3 the yield stopped: of 794 pairs in the 0.3-0.49 band, Jev was
 * convinced about exactly those two.
 *
 * A judge that reads meaning earns the wider net. The rules cannot use it:
 * they only compare words, so a looser shortlist would hand them pairs they
 * are certain to get wrong.
 */
const SHORTLIST = { rules: 0.5, judged: 0.35 };

export function containment(left: string, right: string): number {
  const a = new Set(normalise(left).split(" ").filter((word) => word.length > 3));
  const b = new Set(normalise(right).split(" ").filter((word) => word.length > 3));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/**
 * Review a whole requirement list: which are too vague to test, and which
 * two say the same thing.
 *
 * Rules go first on everything, because they are free. Only what the rules
 * are unsure about is worth paying a model for, and that goes in one batched
 * call rather than one call per question.
 */
interface Pending {
  kind: "vague" | "duplicate";
  id: string;
  other: string | null;
  /** What the rules made of it, used when nothing better answers. */
  rule: Verdict<boolean>;
  /** The state this question needs, keyed by the name the question uses. */
  state: Record<string, unknown>;
  question: Noul;
  /** The plain-language question, for the schema-constrained backend. */
  ask: string;
}

const VAGUE_CRITERIA = {
  true:
    "A tester could not tell whether the system passed or failed: no number, no threshold, no named screen or message, no observable change.",
  false:
    "There is something observable to check — a number, a message, a state change, a named screen — even if the wording is plain.",
};

const SAME_CRITERIA = {
  true:
    "Both describe the same behaviour of the same part of the system; a test for one would cover the other.",
  false:
    "They differ in trigger, actor, data or outcome, so a test for one would leave the other untested.",
};

/** Everything the rules have a view on, with the question to ask about it. */
function pendingFor(items: Item[], cut: number): Pending[] {
  const pending: Pending[] = [];

  for (const item of items) {
    pending.push({
      kind: "vague",
      id: item.id,
      other: null,
      rule: judgeVagueByRule(item.title, item.acceptance),
      state: { [field(item.id)]: { title: item.title, acceptance: item.acceptance } },
      question: {
        type: "noul",
        instructions: `Is the requirement \`${field(item.id)}\` too vague to write a test against?`,
        criteria: VAGUE_CRITERIA,
      },
      ask: `Is this requirement too vague to write a test against? "${item.title} — ${item.acceptance}"`,
    });
  }

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const first = items[i]!;
      const second = items[j]!;
      const left = `${first.title} ${first.acceptance}`;
      const right = `${second.title} ${second.acceptance}`;
      // The shortlist is not a cost dodge: every pair is every pair, and a
      // hundred requirements is five thousand of them. The rules keep the
      // ones worth a second opinion.
      if (containment(left, right) < cut) continue;

      const a = `${field(first.id)}_a`;
      const b = `${field(second.id)}_b`;
      pending.push({
        kind: "duplicate",
        id: first.id,
        other: second.id,
        rule: judgeSameByRule(left, right),
        state: {
          [a]: { title: first.title, acceptance: first.acceptance },
          [b]: { title: second.title, acceptance: second.acceptance },
        },
        question: {
          type: "noul",
          instructions: `Do \`${a}\` and \`${b}\` describe the same behaviour?`,
          criteria: SAME_CRITERIA,
        },
        ask: `Do these two requirements say the same thing? A: "${left}" B: "${right}"`,
      });
    }
  }

  return pending;
}

function found(entry: Pending, confidence: number, why: string, by: Mode): Finding {
  return {
    kind: entry.kind,
    id: entry.id,
    other: entry.other,
    confidence,
    why,
    // Merging two requirements loses one, so it has a higher bar than
    // labelling one as hard to test.
    action: gate(confidence, entry.kind === "duplicate"),
    by,
  };
}

/**
 * Review a whole requirement list: which are too vague to test, and which
 * two say the same thing.
 *
 * Who answers depends on the mode. The rules always have a view; what the
 * mode decides is whose view is used.
 */
export async function review(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const items = (params["requirements"] ?? []) as Item[];
  const mode = (params["mode"] ?? "rules") as Mode;
  const limit = Number(params["limit"]) || 60;

  const pending = pendingFor(items, mode === "jev" ? SHORTLIST.judged : SHORTLIST.rules);
  if (mode === "jev") return byJev(params, pending, items.length);

  const settled = mode === "rules" ? pending : pending.filter((entry) => gate(entry.rule.confidence, entry.kind === "duplicate") === "act");
  const unsure = mode === "rules" ? [] : pending.filter((entry) => gate(entry.rule.confidence, entry.kind === "duplicate") !== "act");

  const findings: Finding[] = settled
    .filter((entry) => entry.rule.answer)
    .map((entry) => found(entry, entry.rule.confidence, entry.rule.why, "rules"));

  let asked = 0;
  if (unsure.length > 0) {
    const batch = unsure.slice(0, limit);
    asked = batch.length;
    const answers = await judgeByModel({
      ...params,
      mode,
      questions: batch.map((entry, index) => ({ id: `q${index + 1}`, ask: entry.ask })),
    });
    const byId = new Map(answers.map((answer) => [answer.id, answer]));

    batch.forEach((entry, index) => {
      const answer = byId.get(`q${index + 1}`);
      if (!answer || !answer.answer) return;
      findings.push(found(entry, answer.confidence, answer.why || entry.rule.why, mode));
    });
  }

  return {
    mode,
    checked: items.length,
    asked,
    ...split(findings),
    inputTokens: 0,
    outputTokens: 0,
  };
}

/**
 * Splits what was found from what was guessed at.
 *
 * A yes at 51% is not a finding. It is the judge saying it does not know,
 * and putting it in a list headed "these are wrong" would be reading
 * conviction into a shrug. Those go in their own, quieter pile.
 */
function split(findings: Finding[]): { findings: Finding[]; unsure: Finding[] } {
  const sorted = [...findings].sort((left, right) => right.confidence - left.confidence);
  return {
    findings: sorted.filter((finding) => finding.action !== "ask"),
    unsure: sorted.filter((finding) => finding.action === "ask"),
  };
}

/**
 * The Jev path. Every question goes to Jev, including the ones the rules
 * were sure about: Jev answers a graded yes/no for a fraction of a cent and
 * is better at this than a keyword list. The one thing the rules still do
 * is shortlist which pairs are worth comparing at all.
 */
async function byJev(
  params: Record<string, unknown>,
  pending: Pending[],
  checked: number,
): Promise<Record<string, unknown>> {
  const key = String(params["key"] ?? "");
  if (!key) throw new Error("no Jev key was supplied");

  const answered = await fanOut(
    {
      key,
      endpoint: typeof params["endpoint"] === "string" ? params["endpoint"] : null,
      model: typeof params["model"] === "string" ? params["model"] : null,
    },
    pending.map((entry) => ({ state: entry.state, question: entry.question })),
    Number(params["atOnce"]) || 4,
  );

  const findings: Finding[] = [];
  for (const [at, answer] of answered.answers) {
    if (answer.noul === undefined || !isYes(answer.noul)) continue;
    const entry = pending[at]!;
    findings.push(
      found(entry, answer.confidence, `Jev put this at ${Math.round(answer.noul * 100)}%`, "jev"),
    );
  }

  return {
    mode: "jev",
    checked,
    asked: answered.answers.size,
    ...split(findings),
    model: answered.model,
    inputTokens: answered.inputTokens,
    outputTokens: answered.outputTokens,
    ...(answered.failures.length > 0
      ? { failed: answered.failures.length, failure: answered.failures[0] }
      : {}),
  };
}

