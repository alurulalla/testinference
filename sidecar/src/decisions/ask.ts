import { checkBalance } from "../engines/balance.js";
import type { Scenario } from "../engines/types.js";
import { matchStep, normalise } from "../engines/steps.js";
import { fanOut, field, type Unit } from "./fanout.js";
import { containment } from "./index.js";
import { isYes } from "./jev.js";

/**
 * The judgement calls the pipeline makes, other than the two in the review.
 *
 * Each one has the same shape: the fallback is plain code that always runs,
 * and with Jev switched on the same question goes to Jev instead. Nothing
 * here writes content — every answer is a yes/no with a confidence, or one
 * option from a named set.
 *
 * Where a wrong answer is expensive, the fallback wins ties. Skipping a
 * paragraph that did carry a requirement loses a requirement nobody knows
 * is missing, so a piece is only skipped when Jev is sure; an unconfirmed
 * destructive action is still confirmed. Being unsure costs a question,
 * never a silent loss.
 */

export type Mode = "rules" | "model" | "jev";

interface Common {
  mode?: Mode;
  key?: string;
  endpoint?: string | null;
  model?: string | null;
  atOnce?: number;
}

function credentialsFrom(params: Common) {
  return {
    key: String(params.key ?? ""),
    endpoint: params.endpoint ?? null,
    model: params.model ?? null,
  };
}

function usingJev(params: Common): boolean {
  return params.mode === "jev" && Boolean(params.key);
}

/** The shape every answer here comes back in. */
export interface Judged<T> {
  id: string;
  answer: T;
  confidence: number;
  why: string;
  by: Mode;
}

interface Result<T> {
  answers: Array<Judged<T>>;
  model: string;
  inputTokens: number;
  outputTokens: number;
  failures: string[];
}

function locally<T>(answers: Array<Judged<T>>): Result<T> {
  return { answers, model: "", inputTokens: 0, outputTokens: 0, failures: [] };
}

// ─── 1. Does this piece of the document carry a requirement? ───────────────

const CARRIES_CRITERIA = {
  true: "It states something the software must do, allow, prevent or show — something a test could pass or fail.",
  false: "It is a heading, a table of contents, a revision history, a legal notice, a glossary entry or any other scaffolding around the content.",
};

/**
 * Reading boilerplate costs money and produces requirements nobody wanted.
 * But a skipped paragraph is a requirement that silently never existed, so
 * a piece is dropped only when Jev is both sure it is not a requirement and
 * confident about it. Everything else is read.
 */
export async function carries(params: Common & { chunks?: Array<{ id: string; text: string }> }) {
  const chunks = params.chunks ?? [];
  if (!usingJev(params)) {
    return locally(
      chunks.map((chunk) => ({
        id: chunk.id,
        answer: true,
        confidence: 0,
        why: "every piece is read when nothing is judging them",
        by: "rules" as Mode,
      })),
    );
  }

  const units: Unit[] = chunks.map((chunk) => ({
    state: { [field(chunk.id)]: chunk.text },
    question: {
      type: "noul",
      instructions: `Does the text \`${field(chunk.id)}\` state a requirement the software must satisfy?`,
      criteria: CARRIES_CRITERIA,
    },
  }));

  const out = await fanOut(credentialsFrom(params), units, params.atOnce);
  return {
    answers: chunks.map((chunk, at) => {
      const answer = out.answers.get(at);
      // No answer means the request failed. Read it rather than lose it.
      if (!answer || answer.noul === undefined) {
        return { id: chunk.id, answer: true, confidence: 0, why: "no answer came back, so it is read", by: "jev" as Mode };
      }
      const skip = !isYes(answer.noul) && answer.confidence >= 0.7;
      return {
        id: chunk.id,
        answer: !skip,
        confidence: answer.confidence,
        why: skip
          ? `Jev is ${Math.round(answer.confidence * 100)}% sure this is not a requirement`
          : `Jev put this at ${Math.round(answer.noul * 100)}%`,
        by: "jev" as Mode,
      };
    }),
    model: out.model,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    failures: out.failures,
  };
}

// ─── 2. What class, priority and feasibility is this scenario? ─────────────

export const CLASS_CRITERIA: Record<string, string> = {
  Positive: "The normal path, with valid input, where the feature is expected to work.",
  Negative: "Invalid input or a refused action, where the system is expected to reject it.",
  Boundary: "The edge of an allowed range: the first, the last, one over, empty, maximum.",
  Security: "Access, permission, authentication, injection or exposure of something private.",
  Edge: "A rare but legitimate combination of conditions.",
  Error: "A failure outside the user's control: a timeout, a dependency down, bad data arriving.",
  Recovery: "Getting back to a working state after a failure or an interruption.",
};

export const FEASIBILITY_CRITERIA: Record<string, string> = {
  Automatable: "A browser or API test could do all of this unattended.",
  Partial: "Most of it could be automated, but something needs a person or an external system.",
  Manual: "It needs human judgement, a physical device, or something no test can drive.",
};

/** A label and how sure the judge was of that one label. */
export interface Label {
  value: string;
  confidence: number;
}

export interface Labels {
  class?: Label;
  feasibility?: Label;
}

/**
 * A second opinion on the labels, from something trained to classify rather
 * than to compose. It returns the whole distribution, so a label it was
 * torn about arrives as a low confidence rather than a confident-looking
 * word.
 *
 * Class and feasibility only. Priority is not asked, and that is a measured
 * decision rather than an omission: on 20 real scenarios Jev answered
 * priority at 51% mean confidence as a `choice` and 50% as an ordered
 * `score`, agreeing with the writing model 6 and 7 times out of 20. Two
 * primitives both at a coin flip means the material does not contain the
 * answer — what a failure costs the business is not in a scenario title,
 * and passing the requirement alongside it did not help either (50%, and
 * 17% more tokens). Class and feasibility come back at 88% and 95%,
 * agreeing 19 times out of 20, so those are worth asking. Priority stays
 * with the writer, where at least one judgement is being made rather than
 * two guesses averaged.
 */
export async function label(
  params: Common & {
    scenarios?: Array<{ id: string; title: string; expected?: string }>;
  },
): Promise<Result<Labels>> {
  const scenarios = params.scenarios ?? [];
  if (!usingJev(params) || scenarios.length === 0) {
    return locally(
      scenarios.map((scenario) => ({
        id: scenario.id,
        answer: {},
        confidence: 0,
        why: "the writing model's own labels stand",
        by: (params.mode ?? "rules") as Mode,
      })),
    );
  }

  const asked: Array<{ id: string; which: keyof Labels }> = [];
  const units: Unit[] = [];
  for (const scenario of scenarios) {
    const name = field(scenario.id);
    const state: Record<string, unknown> = {
      [name]: { title: scenario.title, expected: scenario.expected ?? "" },
    };

    const each: Array<[keyof Labels, string, Record<string, string>]> = [
      ["class", `What kind of test is \`${name}\`?`, CLASS_CRITERIA],
      ["feasibility", `How much of \`${name}\` could a test tool do unattended?`, FEASIBILITY_CRITERIA],
    ];
    for (const [which, question, criteria] of each) {
      asked.push({ id: scenario.id, which });
      units.push({ state, question: { type: "choice", instructions: question, criteria } });
    }
  }

  const out = await fanOut(credentialsFrom(params), units, params.atOnce);

  const labels = new Map<string, Labels>();
  const weakest = new Map<string, number>();
  asked.forEach((entry, at) => {
    const answer = out.answers.get(at);
    if (!answer?.option) return;
    const current = labels.get(entry.id) ?? {};
    // Each label carries its own confidence, so a shaky one does not hold
    // back a certain one. They are separate questions; only the display
    // needs a single number.
    current[entry.which] = { value: answer.option, confidence: answer.confidence };
    labels.set(entry.id, current);
    weakest.set(entry.id, Math.min(weakest.get(entry.id) ?? 1, answer.confidence));
  });

  return {
    answers: scenarios
      .filter((scenario) => labels.has(scenario.id))
      .map((scenario) => ({
        id: scenario.id,
        answer: labels.get(scenario.id) ?? {},
        // One shaky label makes the set shaky, so the lowest one counts.
        confidence: weakest.get(scenario.id) ?? 0,
        why: `Jev labelled this, least sure at ${Math.round((weakest.get(scenario.id) ?? 0) * 100)}%`,
        by: "jev" as Mode,
      })),
    model: out.model,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    failures: out.failures,
  };
}

// ─── 3. Are these scenarios enough for this requirement? ───────────────────

/**
 * Two sharp questions rather than one broad one.
 *
 * Asked "are these scenarios enough to sign off?", Jev answered the real
 * project at 2% to 50% confidence — a shrug, because "enough" bundles
 * several judgements into one word. TypeSafe's own guidance is to break a
 * broad judgement into atomic questions and combine them in code, which is
 * also what the rule underneath does: a thing that works, and a thing that
 * fails.
 */
const WORKS_CRITERIA = {
  true: "At least one scenario checks the requirement doing what it is supposed to do, on the normal path.",
  false: "Nothing here checks the requirement actually working.",
};

const FAILS_CRITERIA = {
  true: "At least one scenario checks the requirement being refused, misused, given bad input, or hitting its limit.",
  false: "Nothing here checks what happens when it goes wrong.",
};

export async function enough(
  params: Common & {
    requirements?: Array<{ id: string; title: string; acceptance: string }>;
    scenarios?: Array<{ reqId: string; title: string; class: string }>;
  },
): Promise<Result<boolean>> {
  const requirements = params.requirements ?? [];
  const scenarios = params.scenarios ?? [];

  // The rule: a requirement that can fail needs a scenario for it failing.
  const balance = checkBalance(
    requirements.map((requirement) => requirement.id),
    scenarios.map((scenario) => ({
      reqId: scenario.reqId,
      class: scenario.class as Scenario["class"],
    })),
  );

  if (!usingJev(params)) {
    return locally(
      balance.map((line) => ({
        id: line.reqId,
        answer: line.note === null,
        confidence: line.note === null ? 0.6 : 0.8,
        why: line.note ?? "it has both a working and a failing case",
        by: (params.mode ?? "rules") as Mode,
      })),
    );
  }

  // A requirement with no scenarios at all needs no judgement.
  const toAsk = requirements.filter((requirement) =>
    scenarios.some((scenario) => scenario.reqId === requirement.id),
  );

  const units: Unit[] = [];
  for (const requirement of toAsk) {
    const name = field(requirement.id);
    const theirs = scenarios.filter((scenario) => scenario.reqId === requirement.id);
    const state = {
      [name]: { title: requirement.title, acceptance: requirement.acceptance },
      [`${name}_scenarios`]: theirs.map((scenario) => `${scenario.class}: ${scenario.title}`),
    };
    units.push({
      state,
      question: {
        type: "noul",
        instructions: `Does any scenario in \`${name}_scenarios\` test \`${name}\` working as intended?`,
        criteria: WORKS_CRITERIA,
      },
    });
    units.push({
      state,
      question: {
        type: "noul",
        instructions: `Does any scenario in \`${name}_scenarios\` test \`${name}\` failing, being refused or being misused?`,
        criteria: FAILS_CRITERIA,
      },
    });
  }

  const out = await fanOut(credentialsFrom(params), units, params.atOnce);

  const answers: Array<Judged<boolean>> = [];
  for (const line of balance) {
    if (line.scenarios === 0) {
      answers.push({ id: line.reqId, answer: false, confidence: 1, why: "no scenarios", by: "jev" });
      continue;
    }
    const at = toAsk.findIndex((requirement) => requirement.id === line.reqId);
    const works = at === -1 ? undefined : out.answers.get(at * 2);
    const fails = at === -1 ? undefined : out.answers.get(at * 2 + 1);

    if (!works?.noul || !fails?.noul) {
      answers.push({
        id: line.reqId,
        answer: line.note === null,
        confidence: 0,
        why: line.note ?? "no answer came back; the rule stands",
        by: "rules",
      });
      continue;
    }

    const missing: string[] = [];
    if (!isYes(works.noul)) missing.push("nothing tests this working");
    if (!isYes(fails.noul)) missing.push("nothing tests this failing");

    answers.push({
      id: line.reqId,
      answer: missing.length === 0,
      // Whichever half the judge was least sure of is how sure it is.
      confidence:
        missing.length === 0
          ? Math.min(works.confidence, fails.confidence)
          : Math.max(
              !isYes(works.noul) ? works.confidence : 0,
              !isYes(fails.noul) ? fails.confidence : 0,
            ),
      why: missing.length === 0 ? "it is tested working and failing" : missing.join(" and "),
      by: "jev",
    });
  }

  return {
    answers,
    model: out.model,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    failures: out.failures,
  };
}

// ─── 4. Is this step already in the library? ───────────────────────────────

const STEP_CRITERIA = {
  true: "The two steps do the same thing to the same thing; one could replace the other in a test with no change in meaning.",
  false: "They differ in the action, the target or the data, so swapping them would change what the test does.",
};

function overlapOf(left: string, right: string): number {
  const a = new Set(normalise(left).split(" ").filter(Boolean));
  const b = new Set(normalise(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * The library keeps the step wording stable across a suite. Matching by
 * words alone misses "Tap the Pay button" against "Click Pay", and merges
 * "Enter a valid card" with "Enter an expired card" — which is the same
 * trap as the sort-order requirements, and the same answer: ask something
 * that reads meaning.
 */
export async function steps(
  params: Common & { proposed?: string[]; library?: string[] },
): Promise<Result<string | null>> {
  const proposed = params.proposed ?? [];
  const library = params.library ?? [];

  if (!usingJev(params)) {
    return locally(
      proposed.map((step) => {
        const match = matchStep(step, library);
        return {
          id: step,
          answer: match.matched,
          confidence: match.score,
          why: match.matched ? `the wording overlaps ${Math.round(match.score * 100)}%` : "nothing close in the library",
          by: (params.mode ?? "rules") as Mode,
        };
      }),
    );
  }

  // The closest thing in the library, by words, for each proposed step.
  //
  // There is no threshold here on purpose. A threshold would be word
  // matching deciding what the meaning-reader is allowed to see, and
  // "Tap Pay" against "Click the Pay button" shares almost no words — which
  // is the exact case worth asking about. Overlap only ranks the candidates.
  const candidates = proposed.map((step) => {
    let best: { step: string; score: number } | null = null;
    for (const existing of library) {
      const score = overlapOf(step, existing);
      if (!best || score > best.score) best = { step: existing, score };
    }
    return best;
  });

  const asking = proposed
    .map((step, at) => ({ step, at, candidate: candidates[at] }))
    // An exact match needs no second opinion, and an empty library has
    // nothing to compare against.
    .filter(
      (entry) =>
        entry.candidate !== null &&
        entry.candidate !== undefined &&
        normalise(entry.step) !== normalise(entry.candidate.step),
    );

  const units: Unit[] = asking.map((entry, index) => ({
    state: {
      [`proposed_${index}`]: entry.step,
      [`existing_${index}`]: entry.candidate!.step,
    },
    question: {
      type: "noul",
      instructions: `Are \`proposed_${index}\` and \`existing_${index}\` the same test step?`,
      criteria: STEP_CRITERIA,
    },
  }));

  const out = await fanOut(credentialsFrom(params), units, params.atOnce);

  const matched = new Map<number, Judged<string | null>>();
  asking.forEach((entry, index) => {
    const answer = out.answers.get(index);
    if (!answer || answer.noul === undefined) return;
    const same = isYes(answer.noul) && answer.confidence >= 0.5;
    matched.set(entry.at, {
      id: entry.step,
      answer: same ? entry.candidate!.step : null,
      confidence: answer.confidence,
      why: same
        ? `Jev is ${Math.round(answer.noul * 100)}% sure this is the same step`
        : "Jev reads these as different steps",
      by: "jev",
    });
  });

  return {
    answers: proposed.map((step, at) => {
      const judged = matched.get(at);
      if (judged) return judged;
      // Not asked, or no answer: fall back to the words.
      const match = matchStep(step, library);
      return {
        id: step,
        answer: match.matched,
        confidence: match.score,
        why: match.matched ? `the wording overlaps ${Math.round(match.score * 100)}%` : "nothing close in the library",
        by: "rules" as Mode,
      };
    }),
    model: out.model,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    failures: out.failures,
  };
}

/**
 * Folds a run's proposed steps into the library, the same as the plain
 * engine does, but reusing a step when the judge recognises it rather than
 * only when the words line up.
 */
export async function foldSteps(
  params: Common & { proposed?: string[]; library?: string[] },
): Promise<Record<string, unknown>> {
  const proposed = params.proposed ?? [];
  const reused: Array<{ proposed: string; existing: string; score: number }> = [];
  const added: string[] = [];
  let library = [...(params.library ?? [])];

  // One pass to judge them all, then fold in order. A step added earlier in
  // this run is in the library for the ones after it, so the second pass
  // still has to match by words — the judge has already been paid for.
  const judged = await steps({ ...params, proposed, library });
  const byStep = new Map(judged.answers.map((entry) => [entry.id, entry]));

  for (const step of proposed) {
    if (step.trim().length === 0) continue;
    const entry = byStep.get(step);
    const existing = entry?.answer ?? matchStep(step, library).matched;
    if (existing && library.includes(existing)) {
      reused.push({ proposed: step, existing, score: Number((entry?.confidence ?? 0).toFixed(2)) });
      continue;
    }
    const late = matchStep(step, library);
    if (late.matched) {
      reused.push({ proposed: step, existing: late.matched, score: Number(late.score.toFixed(2)) });
      continue;
    }
    added.push(step);
    library = [...library, step];
  }

  return {
    reused,
    added,
    library,
    model: judged.model,
    inputTokens: judged.inputTokens,
    outputTokens: judged.outputTokens,
  };
}

// ─── 5. Does this case actually test its scenario? ─────────────────────────

const MATCHES_CRITERIA = {
  true: "Following these steps would exercise what the scenario describes, and the expected result is what that scenario should produce.",
  false: "The steps test something else, stop short of the scenario's point, or the expected result does not follow from them.",
};

/**
 * Nothing checks this without a judge. The validation rules count whether
 * the fields are filled in, which a case can pass while testing the wrong
 * thing entirely. This is the one decision where Jev off means the question
 * simply is not asked.
 */
export async function verify(
  params: Common & {
    cases?: Array<{
      id: string;
      title: string;
      steps: string;
      expected: string;
      scenario: { title: string; expected: string } | null;
    }>;
  },
): Promise<Result<boolean>> {
  const cases = params.cases ?? [];
  if (!usingJev(params)) return locally([]);

  const withScenario = cases.filter((item) => item.scenario !== null);
  const units: Unit[] = withScenario.map((item, index) => ({
    state: {
      [`case_${index}`]: { title: item.title, steps: item.steps, expected: item.expected },
      [`scenario_${index}`]: item.scenario,
    },
    question: {
      type: "noul",
      instructions: `Does the test case \`case_${index}\` actually test the scenario \`scenario_${index}\`?`,
      criteria: MATCHES_CRITERIA,
    },
  }));

  const out = await fanOut(credentialsFrom(params), units, params.atOnce);

  const answers: Array<Judged<boolean>> = [];
  withScenario.forEach((item, at) => {
    const answer = out.answers.get(at);
    if (!answer || answer.noul === undefined) return;
    answers.push({
      id: item.id,
      answer: isYes(answer.noul),
      confidence: answer.confidence,
      why: isYes(answer.noul)
        ? `Jev is ${Math.round(answer.noul * 100)}% sure it does`
        : `Jev is ${Math.round((1 - answer.noul) * 100)}% sure it tests something else`,
      by: "jev",
    });
  });

  return {
    answers,
    model: out.model,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    failures: out.failures,
  };
}

// ─── Linking imported cases back to requirements ──────────────────────────

const LINKS_CRITERIA = {
  true: "Carrying out the case's steps would exercise what the requirement describes. The case is one of the tests you would write for it.",
  false: "The case tests a different behaviour. It might touch the same screen or the same words, but it is not a test of this requirement.",
};

/**
 * How many requirements each case is compared against properly.
 *
 * There is no minimum overlap to clear. Overlap decides the order, never
 * whether the judge sees a candidate at all: a case called "Basket
 * indicator updates after adding a product" shares no words with "Cart
 * shows how many items it holds", and that pair is the entire reason for
 * asking something that reads meaning. Three candidates for every case is
 * a few hundred questions on a real project, which is pennies.
 */
const CANDIDATES = 3;

export interface Link {
  reqId: string;
  confidence: number;
  why: string;
}

/**
 * Works out which requirement each imported case is a test of.
 *
 * A case that arrived in a spreadsheet has no spine: nothing says what it
 * is testing. Word overlap narrows each case to a few plausible
 * requirements — every case against every requirement is thousands of
 * questions — and the judge reads the shortlist properly, because "Cart
 * badge counts items" and "The cart shows a count of items" share almost
 * nothing by words.
 *
 * Nothing is written here. The caller shows the proposals and a person
 * decides; a wrong link is worse than no link, because it makes a
 * requirement look tested when it is not.
 */
export async function link(
  params: Common & {
    cases?: Array<{ id: string; title: string; steps?: string; expected?: string }>;
    requirements?: Array<{ id: string; title: string; acceptance: string }>;
  },
): Promise<Result<Link | null>> {
  const cases = params.cases ?? [];
  const requirements = params.requirements ?? [];
  if (cases.length === 0 || requirements.length === 0) return locally([]);

  const textOf = (item: { title: string; steps?: string; expected?: string }) =>
    `${item.title} ${item.steps ?? ""} ${item.expected ?? ""}`;

  // The few requirements each case could plausibly be about.
  const shortlists = cases.map((item) => {
    return requirements
      .map((requirement) => ({
        requirement,
        score: containment(`${requirement.title} ${requirement.acceptance}`, textOf(item)),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, CANDIDATES);
  });

  if (!usingJev(params)) {
    return locally(
      cases.map((item, at) => {
        const best = shortlists[at]?.[0];
        // Words alone are weak evidence here, so the bar is high and the
        // confidence reported is the overlap itself, not a flattering
        // number derived from it.
        const sure = best !== undefined && best.score >= 0.5;
        return {
          id: item.id,
          answer: sure ? { reqId: best!.requirement.id, confidence: best!.score, why: `${Math.round(best!.score * 100)}% of the requirement's wording appears in the case` } : null,
          confidence: sure ? best!.score : 0,
          why: sure ? "matched on wording alone" : "nothing matched closely enough on wording",
          by: (params.mode ?? "rules") as Mode,
        };
      }),
    );
  }

  const asked: Array<{ at: number; reqId: string }> = [];
  const units: Unit[] = [];
  cases.forEach((item, at) => {
    for (const entry of shortlists[at] ?? []) {
      const caseName = `case_${units.length}`;
      const reqName = `requirement_${units.length}`;
      asked.push({ at, reqId: entry.requirement.id });
      units.push({
        state: {
          [caseName]: { title: item.title, steps: item.steps ?? "", expected: item.expected ?? "" },
          [reqName]: { title: entry.requirement.title, acceptance: entry.requirement.acceptance },
        },
        question: {
          type: "noul",
          instructions: `Is the test case \`${caseName}\` a test of the requirement \`${reqName}\`?`,
          criteria: LINKS_CRITERIA,
        },
      });
    }
  });

  const out = await fanOut(credentialsFrom(params), units, params.atOnce);

  // The strongest yes for each case wins; a case may legitimately touch
  // several requirements, but it traces to one.
  const best = new Map<number, { reqId: string; confidence: number; noul: number }>();
  asked.forEach((entry, index) => {
    const answer = out.answers.get(index);
    if (!answer || answer.noul === undefined || !isYes(answer.noul)) return;
    const current = best.get(entry.at);
    if (!current || answer.confidence > current.confidence) {
      best.set(entry.at, { reqId: entry.reqId, confidence: answer.confidence, noul: answer.noul });
    }
  });

  return {
    answers: cases.map((item, at) => {
      const found = best.get(at);
      const considered = (shortlists[at] ?? []).length;
      if (!found) {
        return {
          id: item.id,
          answer: null,
          confidence: 0,
          why:
            considered === 0
              ? "no requirement was close enough to be worth comparing"
              : `the judge read all ${considered} nearest requirements as testing something else`,
          by: "jev" as Mode,
        };
      }
      return {
        id: item.id,
        answer: {
          reqId: found.reqId,
          confidence: found.confidence,
          why: `Jev put this at ${Math.round(found.noul * 100)}%`,
        },
        confidence: found.confidence,
        why: `Jev put this at ${Math.round(found.noul * 100)}%`,
        by: "jev" as Mode,
      };
    }),
    model: out.model,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    failures: out.failures,
  };
}

// ─── Does the document still say what the requirement says? ───────────────

/**
 * The phrasing matters more than anything else here, and these two were
 * chosen by measurement rather than taste.
 *
 * Asking "does the paragraph support this requirement?" found 1 of 4
 * planted edits: a requirement about a topic sits comfortably beside a
 * paragraph about that topic, so almost everything reads as supported.
 * Asking the inverse, "does the requirement say anything the paragraph does
 * not?", found all 4 but flagged 25 of 40 untouched requirements — noise
 * that would train anyone to ignore the screen.
 *
 * Asking whether the requirement could have been written from the paragraph
 * alone found all 4 and, above the confidence floor below, none of the 40.
 */
const SUPPORTS_CRITERIA = {
  true: "Every part of the requirement traces to something in the paragraph.",
  false: "Writing this requirement needed information that is not in the paragraph — a number, a limit, a condition or a behaviour the paragraph does not give.",
};

/**
 * How sure the judge must be before a gap is reported.
 *
 * Measured on the untouched project: every wrong flag came back under 42%
 * confidence, and the quietest real edit came back at 58%. A half is the
 * gap between them, and without the floor this screen reports ten things
 * that are fine for every four that are not.
 */
const SURE_ITS_DRIFTED = 0.5;

export interface Drift {
  /** The paragraph the requirement was read from. */
  paragraph: string;
  supported: boolean;
}

/**
 * Checks each requirement against the paragraph it came from.
 *
 * Requirements get talked into shape — someone works out that "fast" meant
 * 400ms and fixes the requirement. The document still says "fast". Nobody
 * tells whoever owns the document, which is how a PRD and its tests drift
 * apart over a release.
 *
 * Asking the judge rather than tracking edits catches both directions: a
 * requirement edited away from its source, and a requirement that never
 * quite said what its source said in the first place.
 */
export async function drift(
  params: Common & {
    requirements?: Array<{
      id: string;
      title: string;
      acceptance: string;
      paragraph: string;
      edited: boolean;
    }>;
  },
): Promise<Result<Drift>> {
  const requirements = (params.requirements ?? []).filter((entry) => entry.paragraph.trim());
  if (requirements.length === 0) return locally([]);

  if (!usingJev(params)) {
    // Without a judge the best available signal is whether a person has
    // been at it. It finds the edited ones and misses everything else,
    // which the screen says rather than implying this is the whole list.
    return locally(
      requirements
        .filter((entry) => entry.edited)
        .map((entry) => ({
          id: entry.id,
          answer: { paragraph: entry.paragraph, supported: false },
          confidence: 0.5,
          why: "this was changed by hand, so the document may not say it any more",
          by: (params.mode ?? "rules") as Mode,
        })),
    );
  }

  const units: Unit[] = requirements.map((entry) => {
    const name = field(entry.id);
    return {
      state: {
        [`${name}_paragraph`]: entry.paragraph,
        [name]: { title: entry.title, acceptance: entry.acceptance },
      },
      question: {
        type: "noul",
        instructions: `Could the requirement \`${name}\` have been written using only what the document text \`${name}_paragraph\` says, inventing nothing?`,
        criteria: SUPPORTS_CRITERIA,
      },
    };
  });

  const out = await fanOut(credentialsFrom(params), units, params.atOnce);

  const answers: Array<Judged<Drift>> = [];
  requirements.forEach((entry, at) => {
    const answer = out.answers.get(at);
    if (!answer || answer.noul === undefined) return;
    if (isYes(answer.noul)) return;
    // A hesitant no is the judge shrugging at a loosely worded paragraph,
    // not evidence that the document has fallen behind.
    if (answer.confidence < SURE_ITS_DRIFTED) return;
    answers.push({
      id: entry.id,
      answer: { paragraph: entry.paragraph, supported: false },
      confidence: answer.confidence,
      why: entry.edited
        ? `changed by hand, and the document does not say it (${Math.round((1 - answer.noul) * 100)}%)`
        : `the document does not say this (${Math.round((1 - answer.noul) * 100)}%)`,
      by: "jev",
    });
  });

  answers.sort((left, right) => right.confidence - left.confidence);
  return {
    answers,
    model: out.model,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    failures: out.failures,
  };
}

// ─── How much does this edit disturb? ─────────────────────────────────────

export const CHANGE_CRITERIA: Record<string, string> = {
  wording:
    "The same thing said differently: a typo, grammar, a clearer phrase. Anyone testing the old version would write exactly the same test for the new one.",
  sharper:
    "The same thing, pinned down: a vague word replaced by a number, a threshold or a named condition. The old tests are still valid but may no longer be enough.",
  different:
    "A different thing. The behaviour, the actor, the data or the outcome has changed, so a test for the old version is now testing something nobody asked for.",
};

const KEEPS_CRITERIA = {
  true: "Everything the old wording required is still required by the new wording.",
  false: "The new wording drops something the old one covered — a case, a condition or a behaviour that nobody has said should go.",
};

export interface Change {
  /** wording · sharper · different */
  kind: string;
  /** False when the new wording quietly drops something the old one had. */
  keeps: boolean;
  lost: string | null;
}

/**
 * Reads an edit and says how far its consequences reach.
 *
 * A typo should not make eleven test cases suspect, and a changed behaviour
 * should not slip through as a tidy-up. Two questions, because they are
 * different questions: how big is this, and did anything fall out of it.
 * Narrowing a requirement by accident is the easy mistake when someone is
 * busy making it precise.
 */
export async function change(
  params: Common & {
    before?: { title: string; acceptance: string };
    after?: { title: string; acceptance: string };
  },
): Promise<Judged<Change>> {
  const before = params.before;
  const after = params.after;
  if (!before || !after) throw new Error("need both the old and the new wording");

  // Without a judge, assume the most disruptive reading. Treating an
  // unknown edit as harmless is how a changed requirement slips past
  // eleven tests that no longer match it.
  if (!usingJev(params)) {
    return {
      id: "change",
      answer: { kind: "different", keeps: true, lost: null },
      confidence: 0,
      why: "nothing is judging this, so it is treated as a real change",
      by: (params.mode ?? "rules") as Mode,
    };
  }

  const state = { before, after };
  const out = await fanOut(
    credentialsFrom(params),
    [
      {
        state,
        question: {
          type: "choice",
          instructions: "How far has the requirement moved from `before` to `after`?",
          criteria: CHANGE_CRITERIA,
        },
      },
      {
        state,
        question: {
          type: "noul",
          instructions: "Does `after` still require everything `before` required?",
          criteria: KEEPS_CRITERIA,
        },
      },
    ],
    2,
  );

  const kind = out.answers.get(0);
  const keeps = out.answers.get(1);

  // An unanswered question is not permission to disturb nothing.
  const decided = kind?.option && (kind.confidence ?? 0) >= 0.5 ? kind.option : "different";
  const stillKeeps = keeps?.noul === undefined ? true : isYes(keeps.noul);

  return {
    id: "change",
    answer: {
      kind: decided,
      keeps: stillKeeps,
      lost: stillKeeps ? null : "the new wording drops something the old one covered",
    },
    confidence: kind?.confidence ?? 0,
    why:
      decided === "wording"
        ? "the same thing said differently"
        : decided === "sharper"
          ? "the same thing, pinned down"
          : "this asks for something different",
    by: "jev",
  };
}

// ─── 6. Is this chat message asking to destroy something? ──────────────────

const DESTRUCTIVE_CRITERIA = {
  true: "Carrying it out would delete, clear, overwrite or discard work that exists, and getting it back would mean doing that work again.",
  false: "It adds, reads, re-labels or rearranges something, and anything it changes could be changed back.",
};

/**
 * The named actions are already known to be destructive, and that list is
 * never overruled — Jev can add to it, not subtract from it. What it adds
 * is catching a request whose action name looks harmless but whose effect
 * is not.
 */
export async function gateAction(
  params: Common & { action?: string; message?: string; known?: boolean },
): Promise<Judged<boolean>> {
  const known = Boolean(params.known);
  if (known || !usingJev(params)) {
    return {
      id: String(params.action ?? ""),
      answer: known,
      confidence: known ? 1 : 0,
      why: known ? "this action is on the list that always needs confirming" : "not a listed destructive action",
      by: known ? "rules" : ((params.mode ?? "rules") as Mode),
    };
  }

  const out = await fanOut(
    credentialsFrom(params),
    [
      {
        state: { request: params.message ?? "", action: params.action ?? "" },
        question: {
          type: "noul",
          instructions: "Would carrying out `request` by doing `action` destroy work that cannot be recovered?",
          criteria: DESTRUCTIVE_CRITERIA,
        },
      },
    ],
    1,
  );

  const answer = out.answers.get(0);
  if (!answer || answer.noul === undefined) {
    // No answer is not a licence to skip the confirmation.
    return { id: String(params.action ?? ""), answer: true, confidence: 0, why: "no answer came back, so it is confirmed anyway", by: "jev" };
  }
  return {
    id: String(params.action ?? ""),
    answer: isYes(answer.noul),
    confidence: answer.confidence,
    why: isYes(answer.noul)
      ? `Jev is ${Math.round(answer.noul * 100)}% sure this destroys work`
      : "Jev reads this as reversible",
    by: "jev",
  };
}
