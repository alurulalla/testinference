import type { Intent } from "./intents.js";
import type { Matched } from "./match.js";

/**
 * Writing the spec file.
 *
 * One rule governs everything here: a test that checks nothing must not
 * be allowed to pass. A generated file full of green ticks that asserts
 * nothing is worse than no file at all, because it buys false confidence
 * and nobody looks again. Anything unfinished is marked `test.fixme`, so
 * it reports as not done rather than as done.
 */

export interface Line {
  /** The step's own words, kept as a comment beside the code. */
  from: string;
  code: string | null;
  /** Why there is no code, when there is none. */
  problem: string | null;
  confidence: number;
}

export interface Spec {
  id: string;
  title: string;
  lines: Line[];
  /** Steps with no control, and checks that could not be written. */
  unfinished: number;
  checks: number;
}

function text(value: string): string {
  return JSON.stringify(value);
}

/** `getByRole('button', { name: 'Login' })` → `page.getByRole(...)`. */
function on(selector: string): string {
  return `page.${selector}`;
}

export function lineFor(intent: Intent, matched: Matched, startUrl: string): Line {
  const base = { from: intent.from, confidence: matched.confidence };

  if (intent.target.startsWith("CANNOT:")) {
    return {
      ...base,
      code: null,
      problem: intent.target.slice("CANNOT:".length).trim() || "a browser cannot do this step",
    };
  }

  if (intent.action === "goto") {
    return { ...base, code: `await page.goto(${text(intent.value || startUrl)});`, problem: null };
  }

  if (intent.action === "expectUrl") {
    return { ...base, code: `await expect(page).toHaveURL(${text(intent.value)});`, problem: null };
  }

  // A check pointed at the wrong element passes or fails for the wrong
  // reason, which is worse than checking the whole page. So a specific
  // element is used only when the judge was sure of it.
  const vagueCheck = intent.action === "expectText" && matched.confidence < 0.7;

  if (intent.action === "expectText" && (!matched.control || vagueCheck)) {
    // Checking the whole page for the text is weaker than checking one
    // element, but it is a real assertion, which is what matters.
    return intent.value
      ? { ...base, code: `await expect(page.getByText(${text(intent.value)})).toBeVisible();`, problem: null }
      : { ...base, code: null, problem: "the expected result does not say what should be visible" };
  }

  if (!matched.control) {
    return { ...base, code: null, problem: matched.why };
  }

  const target = on(matched.control.selector);
  // A selector matching several things would act on whichever the browser
  // reached first, so the code says which one and the reader can see it.
  const one = matched.control.matches > 1 ? `${target}.first()` : target;

  switch (intent.action) {
    case "fill":
      return { ...base, code: `await ${one}.fill(${text(intent.value)});`, problem: null };
    case "click":
      return { ...base, code: `await ${one}.click();`, problem: null };
    case "check":
      return { ...base, code: `await ${one}.check();`, problem: null };
    case "select":
      return { ...base, code: `await ${one}.selectOption(${text(intent.value)});`, problem: null };
    case "expectText":
      return intent.value
        ? { ...base, code: `await expect(${one}).toContainText(${text(intent.value)});`, problem: null }
        : { ...base, code: `await expect(${one}).toBeVisible();`, problem: null };
    default:
      return { ...base, code: null, problem: `nothing is written for a ${intent.action} step` };
  }
}

export function specFor(
  testCase: { id: string; title: string },
  lines: Line[],
  startUrl: string,
): Spec {
  const checks = lines.filter((line) => line.code?.includes("expect(")).length;
  const unfinished = lines.filter((line) => line.code === null).length;
  void startUrl;
  return { id: testCase.id, title: testCase.title, lines, unfinished, checks };
}

/** The whole file, for one group of cases. */
export function fileFor(specs: Spec[], startUrl: string, generatedBy: string): string {
  const out: string[] = [
    "// Written by TestInference from approved test cases and an explored map",
    `// of ${startUrl}. ${generatedBy}`,
    "//",
    "// Edit freely. Re-generating overwrites this file, so anything you want",
    "// to keep belongs in the test case it came from.",
    "",
    `import { expect, test } from "@playwright/test";`,
    "",
  ];

  for (const spec of specs) {
    // A test with nothing to assert, or a step nobody could write, is not
    // a passing test. fixme reports it as unfinished, which is the truth.
    const skip = spec.unfinished > 0 || spec.checks === 0;
    const why =
      spec.checks === 0 && spec.unfinished === 0
        ? "nothing in the expected result could be turned into a check"
        : `${spec.unfinished} step${spec.unfinished === 1 ? "" : "s"} could not be written`;

    out.push(`// ${spec.id}`);
    if (skip) out.push(`// Unfinished: ${why}. Fix the lines marked below, then remove test.fixme.`);
    out.push(`test${skip ? ".fixme" : ""}(${text(`${spec.id} · ${spec.title}`)}, async ({ page }) => {`);
    out.push(`  await page.goto(${text(startUrl)});`);

    for (const line of spec.lines) {
      out.push(`  // ${line.from.replace(/\s+/g, " ").trim()}`);
      if (line.code) {
        const shaky = line.confidence > 0 && line.confidence < 0.7 ? "   // unsure this is the right control" : "";
        out.push(`  ${line.code}${shaky}`);
      } else {
        out.push(`  // TODO: ${line.problem}`);
      }
    }

    out.push("});", "");
  }

  return out.join("\n");
}
