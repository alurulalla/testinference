import { containment } from "../decisions/index.js";
import { fanOut, type Unit } from "../decisions/fanout.js";
import type { Intent } from "./intents.js";

/**
 * Which real control does "the Login button" mean?
 *
 * This is the question the whole exploration exists to make answerable.
 * Without a map it is "invent a selector", which is guessing. With one it
 * is "here are the controls that exist on this page, pick one" — a choice
 * among real things, which is what a judge is for.
 *
 * Word overlap ranks the candidates; it never decides. "Basket" and
 * "Cart" share no letters and are the same control, which is exactly the
 * case worth asking about.
 */

export interface Control {
  page: string;
  role: string | null;
  name: string | null;
  selector: string;
  kind: string;
  matches: number;
  sturdiness: number;
}

export interface Matched {
  /** The control chosen, or null when nothing fits. */
  control: Control | null;
  confidence: number;
  why: string;
  by: "rules" | "jev";
}

/** How many real controls each target is weighed against. */
const CANDIDATES = 5;

function describe(control: Control): string {
  return `${control.role ?? control.kind} "${control.name ?? "unnamed"}"`;
}

/** Controls a given action could sensibly act on. */
function plausible(controls: Control[], action: Intent["action"]): Control[] {
  switch (action) {
    case "fill":
      return controls.filter((control) => control.kind === "input");
    case "click":
      return controls.filter((control) => control.kind === "control" || control.kind === "link");
    case "check":
      return controls.filter((control) => control.role === "checkbox" || control.role === "radio");
    case "select":
      return controls.filter((control) => control.role === "combobox");
    default:
      // A check reads something, so the things worth reading are headings
      // and text. A button is almost never what "the page heading reads
      // 'Sign in'" means, and pointing an assertion at the wrong control
      // is worse than a weaker assertion that is right.
      return controls.filter(
        (control) => control.kind === "text" || control.role === "heading" || control.role === "alert",
      );
  }
}

const FITS = {
  true: "This control is the one the step means. Acting on it would do what the step describes.",
  false: "This is a different control. It might be on the same screen or have a similar name, but it is not what the step is aimed at.",
};

export async function matchTargets(
  intents: Intent[],
  controls: Control[],
  judge: Record<string, unknown>,
): Promise<{ matched: Matched[]; asked: number; inputTokens: number }> {
  const shortlists = intents.map((intent) => {
    if (intent.action === "goto" || intent.target.startsWith("CANNOT:")) return [];
    const possible = plausible(controls, intent.action);
    return possible
      .map((control) => ({ control, score: containment(intent.target, describe(control)) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, CANDIDATES);
  });

  const key = typeof judge["key"] === "string" ? judge["key"] : "";
  if (judge["mode"] !== "jev" || !key) {
    return {
      matched: intents.map((_intent, at) => {
        const best = shortlists[at]?.[0];
        // Words alone are weak here, so the bar is high and a near miss
        // is reported as no match rather than as a guess.
        const sure = best !== undefined && best.score >= 0.6;
        return {
          control: sure ? best!.control : null,
          confidence: sure ? best!.score : 0,
          why: sure ? "matched on wording" : "nothing on the explored pages matches this closely",
          by: "rules" as const,
        };
      }),
      asked: 0,
      inputTokens: 0,
    };
  }

  const asked: Array<{ at: number; control: Control }> = [];
  const units: Unit[] = [];
  for (const [at, intent] of intents.entries()) {
    for (const entry of shortlists[at] ?? []) {
      const name = `candidate_${units.length}`;
      const step = `step_${units.length}`;
      asked.push({ at, control: entry.control });
      units.push({
        state: {
          [step]: intent.from,
          [name]: { what: describe(entry.control), onPage: entry.control.page },
        },
        question: {
          type: "noul" as const,
          instructions: `The test step \`${step}\` acts on something. Is \`${name}\` the control it means?`,
          criteria: FITS,
        },
      });
    }
  }

  const out = await fanOut(
    {
      key,
      endpoint: typeof judge["endpoint"] === "string" ? judge["endpoint"] : null,
      model: typeof judge["model"] === "string" ? judge["model"] : null,
    },
    units,
    Number(judge["atOnce"]) || 4,
  );

  const best = new Map<number, { control: Control; confidence: number; noul: number }>();
  asked.forEach((entry, index) => {
    const answer = out.answers.get(index);
    if (!answer || answer.noul === undefined || answer.noul < 0.5) return;
    const current = best.get(entry.at);
    if (!current || answer.confidence > current.confidence) {
      best.set(entry.at, { control: entry.control, confidence: answer.confidence, noul: answer.noul });
    }
  });

  return {
    matched: intents.map((intent, at) => {
      if (intent.action === "goto") {
        return { control: null, confidence: 1, why: "no control needed", by: "jev" as const };
      }
      const found = best.get(at);
      if (!found) {
        const considered = (shortlists[at] ?? []).length;
        return {
          control: null,
          confidence: 0,
          why:
            considered === 0
              ? "no control of the right kind was explored"
              : `none of the ${considered} nearest controls is the one this step means`,
          by: "jev" as const,
        };
      }
      return {
        control: found.control,
        confidence: found.confidence,
        why: `Jev put this at ${Math.round(found.noul * 100)}%`,
        by: "jev" as const,
      };
    }),
    asked: out.answers.size,
    inputTokens: out.inputTokens,
  };
}
