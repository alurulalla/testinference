/**
 * Keeping the step library from rotting.
 *
 * Without a check, every run invents its own phrasing and the library ends up
 * holding four spellings of the same step. This is a lexical check — it
 * normalises wording and parameters and compares what is left. It is not
 * semantic: when the local index arrives it can judge meaning, and until then
 * the screen says which kind of check ran.
 */

export interface StepMatch {
  step: string;
  matched: string | null;
  score: number;
}

const KEYWORDS = /^(given|when|then|and|but)\s+/i;

export function normalise(step: string): string {
  return step
    .replace(KEYWORDS, "")
    .replace(/<[^>]*>/g, "<>") // one parameter is as good as another
    .replace(/"[^"]*"/g, '""')
    .replace(/\d+/g, "#")
    .toLowerCase()
    .replace(/[^a-z0-9<>#"\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlap(left: string, right: string): number {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Near enough that two steps are the same step. */
export const SAME = 0.85;

export function matchStep(step: string, library: string[]): StepMatch {
  const target = normalise(step);
  let best: StepMatch = { step, matched: null, score: 0 };

  for (const existing of library) {
    const score = target === normalise(existing) ? 1 : overlap(target, normalise(existing));
    if (score > best.score) best = { step, matched: existing, score };
  }

  return best.score >= SAME ? best : { step, matched: null, score: best.score };
}

export interface LibraryUpdate {
  reused: Array<{ proposed: string; existing: string; score: number }>;
  added: string[];
  library: string[];
}

/** Folds a run's proposed steps into the library, reusing what already fits. */
export function foldIn(proposed: string[], library: string[]): LibraryUpdate {
  const reused: LibraryUpdate["reused"] = [];
  const added: string[] = [];
  const next = [...library];

  for (const step of proposed) {
    if (step.trim().length === 0) continue;
    const match = matchStep(step, next);
    if (match.matched) {
      reused.push({ proposed: step, existing: match.matched, score: Number(match.score.toFixed(2)) });
    } else {
      next.push(step.trim());
      added.push(step.trim());
    }
  }

  return { reused, added, library: next };
}
