import { chromium, type Browser, type Page } from "playwright";
import { locate } from "../explore/resolve.js";
import { log } from "../protocol.js";

/**
 * Running the tests, step by step, and saying what happened.
 *
 * It replays the same plan the written file was made from, so what you
 * watch here and what CI runs cannot disagree. The file is the artifact
 * you commit; this is the one that tells you, step by step, which line
 * went wrong and what the page looked like when it did.
 *
 * A step that could not be written is not skipped quietly — the case
 * carries it as a gap and is reported unfinished, never passed.
 */

export interface Step {
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
  steps: Step[];
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
  /** Where the page was when it ended, useful when something failed. */
  endedAt: string | null;
  /** A PNG of the moment it failed, base64, for the screen to show. */
  shot: string | null;
  detail: string | null;
}

/** Long enough for a slow page, short enough that a wedged run ends. */
const STEP_MS = 15_000;

/**
 * A check gets less patience than an action.
 *
 * Waiting fifteen seconds for text that is not there costs fifteen
 * seconds per failing test, and a suite of failures becomes a suite you
 * stop running. Five is long enough for anything that is going to appear.
 */
const CHECK_MS = 5_000;

async function doStep(page: Page, step: Step, startUrl: string): Promise<void> {
  const target = step.selector ? locate(page, step.selector) : null;
  const one = target && step.first ? target.first() : target;

  switch (step.action) {
    case "goto":
      // A plan written before the address was resolved still has to go
      // somewhere, and the start is where the written file would go.
      await page.goto(step.value || startUrl, { waitUntil: "domcontentloaded", timeout: STEP_MS });
      return;
    case "fill":
      await one!.fill(step.value, { timeout: STEP_MS });
      return;
    case "click":
      await one!.click({ timeout: STEP_MS });
      return;
    case "check":
      await one!.check({ timeout: STEP_MS });
      return;
    case "select":
      await one!.selectOption(step.value, { timeout: STEP_MS });
      return;
    case "expectUrl": {
      await page.waitForURL(step.value, { timeout: CHECK_MS }).catch(() => {});
      if (!page.url().includes(step.value)) {
        throw new Error(`the address is ${page.url()}, not ${step.value}`);
      }
      return;
    }
    case "expectText": {
      // No selector means check the whole page, which is what the written
      // file does when the judge was unsure which element was meant.
      const where = one ?? page.getByText(step.value);
      try {
        await where.first().waitFor({ state: "visible", timeout: CHECK_MS });
      } catch {
        // "Timeout 5000ms exceeded" is true and useless. The thing a
        // person needs is what was looked for and what was there.
        throw new Error(
          step.selector
            ? `the element it checks never appeared`
            : `"${step.value}" is not on the page`,
        );
      }
      if (step.selector && step.value) {
        const text = (await where.first().innerText()).replace(/\s+/g, " ");
        if (!text.includes(step.value)) {
          throw new Error(`it reads "${text.slice(0, 80)}", which does not contain "${step.value}"`);
        }
      }
      return;
    }
    default:
      throw new Error(`nothing is written for a ${step.action} step`);
  }
}

export async function play(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const plans = (params["plans"] ?? []) as Plan[];
  const startUrl = String(params["startUrl"] ?? "");
  const headed = params["watch"] === true;

  const results: CaseResult[] = [];
  let browser: Browser | null = null;

  try {
    try {
      browser = await chromium.launch({ headless: !headed });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        detail.includes("Executable doesn't exist") || detail.includes("playwright install")
          ? "the browser this needs has not been downloaded yet — run: npx playwright install chromium"
          : `the browser would not start: ${detail}`,
      );
    }

    for (const plan of plans) {
      const began = Date.now();

      if (!plan.runnable) {
        results.push({
          id: plan.id,
          title: plan.title,
          state: "unfinished",
          ms: 0,
          steps: plan.steps.map((step) => ({
            from: step.from,
            state: step.problem ? "skipped" : "skipped",
            ms: 0,
            detail: step.problem,
          })),
          endedAt: null,
          shot: null,
          detail: "this test was never finished, so it was not run",
        });
        continue;
      }

      // Its own context, so one test cannot leave another signed in.
      const context = await browser.newContext();
      const page = await context.newPage();
      const steps: StepResult[] = [];
      let failed: string | null = null;
      let shot: string | null = null;

      try {
        await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: STEP_MS });
      } catch (error: unknown) {
        failed = `could not open ${startUrl}: ${error instanceof Error ? error.message : String(error)}`;
      }

      for (const step of plan.steps) {
        if (failed) {
          steps.push({ from: step.from, state: "skipped", ms: 0, detail: "an earlier step failed" });
          continue;
        }
        const at = Date.now();
        try {
          await doStep(page, step, startUrl);
          steps.push({ from: step.from, state: "passed", ms: Date.now() - at, detail: null });
        } catch (error: unknown) {
          const detail = (error instanceof Error ? error.message : String(error))
            .split("\n")[0]!
            .slice(0, 300);
          steps.push({ from: step.from, state: "failed", ms: Date.now() - at, detail });
          failed = detail;
          try {
            shot = (await page.screenshot({ type: "png" })).toString("base64");
          } catch {
            log(`could not take a screenshot for ${plan.id}`);
          }
        }
      }

      results.push({
        id: plan.id,
        title: plan.title,
        state: failed ? "failed" : "passed",
        ms: Date.now() - began,
        steps,
        endedAt: page.url(),
        shot,
        detail: failed,
      });
      await context.close();
    }
  } finally {
    await browser?.close();
  }

  return {
    results,
    passed: results.filter((result) => result.state === "passed").length,
    failed: results.filter((result) => result.state === "failed").length,
    unfinished: results.filter((result) => result.state === "unfinished").length,
  };
}
