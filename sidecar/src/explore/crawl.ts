import { chromium, type Browser, type Page } from "playwright";
import { log } from "../protocol.js";
import { locate } from "./resolve.js";
import { foldTemplates, patternOf, shapeOf } from "./template.js";
import { candidatesFor, type How, type Seen } from "./selectors.js";

/**
 * Walking an application to see what is really there.
 *
 * Read-only by construction. It follows links and it reads pages. It does
 * not click buttons, submit forms, or type into anything, with one
 * exception the person configures: a sign-in, because most applications
 * are a login page and nothing else until you are through it.
 *
 * That restraint is not timidity. A crawler that clicks whatever it finds
 * will eventually click "Delete account" on someone's staging environment,
 * and no blocklist of words is good enough — "Remove" is dangerous,
 * "Remove filter" is not. Following links only is safe because it is
 * narrow, not because something clever is guarding it.
 */

export interface Element {
  tag: string;
  role: string | null;
  name: string | null;
  how: How;
  selector: string;
  sturdiness: number;
  /** How many elements this matched, when it was tried. */
  matches: number;
  /**
   * Whether it was tried at all. Without this, "nothing matched" and
   * "never looked" are both zero, and a page of unchecked links reads as
   * a page of broken selectors.
   */
  checked: boolean;
  /** What a test would do with it: read, fill or press. */
  kind: "input" | "control" | "link" | "text";
}

export interface Seen_Page {
  url: string;
  title: string;
  /** Changes when the page's structure changes, for delta runs. */
  fingerprint: string;
  /** The address with its identifiers removed: /product/{}. */
  pattern: string;
  /** What the page is made of, with the words left out. */
  shape: string;
  /** Other addresses that turned out to be this same screen. */
  examples: string[];
  elements: Element[];
  links: string[];
  /** Pages this one was reached from. */
  from: string | null;
}

export interface Walk {
  pages: Seen_Page[];
  visited: number;
  skipped: string[];
  /** Addresses not visited because their screen had been seen enough. */
  repeats: number;
  /** Pages folded together afterwards as one screen. */
  folded: number;
  note: string;
}

/**
 * How many addresses sharing one pattern are worth visiting by default.
 *
 * Three is enough to see the screen and to have something to compare.
 * Measured on a shop with forty products and a budget of twenty pages:
 * without the cap the crawl spends every visit on products and reaches
 * neither the basket nor the checkout; with it, four pages cover the
 * whole shop. Raisable for an application whose pages genuinely differ
 * behind similar addresses.
 */
const PER_PATTERN = 3;

/** Collected inside the page, where the DOM is. */
const READ = `() => {
  const visible = (node) => {
    const box = node.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return false;
    const style = window.getComputedStyle(node);
    return style.visibility !== "hidden" && style.display !== "none";
  };

  const path = (node) => {
    const parts = [];
    let at = node;
    while (at && at.nodeType === 1 && parts.length < 4) {
      let part = at.tagName.toLowerCase();
      if (at.id) { parts.unshift(part + "#" + at.id); break; }
      const classes = (at.className || "").toString().trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (classes.length) part += "." + classes.join(".");
      parts.unshift(part);
      at = at.parentElement;
    }
    return parts.join(" > ");
  };

  const labelFor = (node) => {
    if (node.labels && node.labels.length) return node.labels[0].innerText.trim();
    const aria = node.getAttribute("aria-label");
    if (aria) return aria.trim();
    return null;
  };

  const roleOf = (node) => {
    const explicit = node.getAttribute("role");
    if (explicit) return explicit;
    const tag = node.tagName.toLowerCase();
    if (tag === "a" && node.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (node.getAttribute("type") || "text").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    return null;
  };

  const nameOf = (node) => {
    const aria = node.getAttribute("aria-label");
    if (aria) return aria.trim();
    if (node.tagName.toLowerCase() === "input") {
      const value = node.getAttribute("value");
      const type = (node.getAttribute("type") || "").toLowerCase();
      if (value && (type === "submit" || type === "button")) return value.trim();
      return labelFor(node);
    }
    const text = (node.innerText || "").trim().replace(/\\s+/g, " ");
    return text ? text.slice(0, 80) : null;
  };

  const wanted = Array.from(
    document.querySelectorAll("a[href], button, input, select, textarea, [role], h1, h2, h3"),
  ).filter(visible);

  const seen = wanted.map((node) => ({
    tag: node.tagName.toLowerCase(),
    role: roleOf(node),
    name: nameOf(node),
    testId: node.getAttribute("data-testid") || node.getAttribute("data-test") || null,
    testIdAttribute: node.getAttribute("data-testid")
      ? "data-testid"
      : node.getAttribute("data-test")
        ? "data-test"
        : null,
    label: labelFor(node),
    placeholder: node.getAttribute("placeholder"),
    text: (node.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 80) || null,
    id: node.id || null,
    css: path(node),
  }));

  // How many elements would answer to the same role and name. Six "Add to
  // cart" buttons is the normal case, and a selector matching all six is
  // worse than no selector.
  const counts = new Map();
  for (const item of seen) {
    const key = item.role + "\\u0000" + item.name;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const item of seen) {
    item.duplicates = counts.get(item.role + "\\u0000" + item.name) || 1;
  }

  return {
    title: document.title,
    seen,
    links: Array.from(document.querySelectorAll("a[href]"))
      .map((node) => node.href)
      .filter(Boolean),
  };
}`;

function kindOf(element: Seen): Element["kind"] {
  if (element.tag === "input" || element.tag === "textarea" || element.tag === "select") {
    return element.role === "button" ? "control" : "input";
  }
  if (element.role === "link") return "link";
  if (element.role === "button" || element.role === "checkbox" || element.role === "radio") {
    return "control";
  }
  return "text";
}

/** Same page, different visit: strip the fragment and trailing slash. */
function normalise(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/$/, "");
    return `${parsed.origin}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

function fingerprintOf(elements: Element[]): string {
  const text = elements.map((element) => `${element.role}:${element.name}`).join("|");
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * How many selectors are checked in the browser on one page.
 *
 * Each check is a round trip, and a Wikipedia article has over a thousand
 * controls — verifying every one took a minute for four pages. The things
 * a test actually touches are inputs and buttons, and there are rarely
 * many; links are capped, because the five hundredth link in an article
 * body is not what anyone is writing a test against.
 */
const VERIFY = 150;

/** Inputs first, then buttons, then links: the order tests care about. */
function worthChecking(kind: Element["kind"]): number {
  if (kind === "input") return 0;
  if (kind === "control") return 1;
  if (kind === "link") return 2;
  return 3;
}

async function readPage(page: Page, from: string | null): Promise<Seen_Page> {
  // Invoked, not merely evaluated: a string that is only a function
  // expression hands back the function, not what it collected.
  const raw = (await page.evaluate(`(${READ})()`)) as {
    title: string;
    seen: Seen[];
    links: string[];
  };

  // Each selector is tried against the page it came from. A selector that
  // matches six things is not a selector, and only the browser can say —
  // Playwright matches a role by its accessible name, which is not always
  // the text this collected.
  // Checked in the order a test cares about, so when the budget runs out
  // it runs out on the five hundredth link rather than on a form field.
  const order = raw.seen
    .map((item, at) => ({ at, rank: worthChecking(kindOf(item)) }))
    .sort((left, right) => left.rank - right.rank || left.at - right.at);
  const checking = new Set(order.slice(0, VERIFY).map((entry) => entry.at));

  const elements: Element[] = [];
  for (const [at, item] of raw.seen.entries()) {
    const kind = kindOf(item);
    const candidates = candidatesFor(item);

    let chosen = candidates[candidates.length - 1]!;
    let matches = 0;

    // Text is not interacted with, and anything past the budget keeps the
    // best guess with its count left at zero, which reads as "not checked"
    // rather than as a promise.
    if (kind === "text" || !checking.has(at)) {
      chosen = candidates[0] ?? chosen;
      matches = kind === "text" ? (item.duplicates ?? 1) : 0;
    } else {
      for (const candidate of candidates) {
        const count = await locate(page, candidate.selector)
          .count()
          .catch(() => -1);
        if (count === 1) {
          chosen = candidate;
          matches = 1;
          break;
        }
        if (matches === 0 && count > 0) {
          chosen = candidate;
          matches = count;
        }
      }
    }

    const checked = kind !== "text" && checking.has(at);
    elements.push({
      tag: item.tag,
      role: item.role,
      name: item.name,
      how: chosen.how,
      selector: chosen.selector,
      // A selector that matches several things is worth less than its rung
      // suggests, whatever rung it is on. One that was never tried keeps
      // its rung's score and says it was not tried.
      sturdiness: !checked || matches === 1 ? chosen.sturdiness : chosen.sturdiness * 0.4,
      matches,
      checked,
      kind,
    });
  }

  const url = normalise(page.url());
  return {
    url,
    title: raw.title,
    fingerprint: fingerprintOf(elements),
    pattern: patternOf(url),
    shape: shapeOf(elements),
    examples: [],
    elements,
    links: [...new Set(raw.links.map(normalise))],
    from,
  };
}

export interface SignIn {
  /** Selectors are Playwright expressions, e.g. getByPlaceholder('Username'). */
  username: string;
  password: string;
  submit: string;
  user: string;
  secret: string;
}

/** Runs the one deliberate interaction: the sign-in the person configured. */
async function signIn(page: Page, how: SignIn): Promise<void> {
  await locate(page, how.username).fill(how.user);
  await locate(page, how.password).fill(how.secret);
  await locate(page, how.submit).click();
  await page.waitForLoadState("domcontentloaded");
}

export async function crawl(params: Record<string, unknown>): Promise<Walk> {
  const start = String(params["url"] ?? "").trim();
  if (!start) throw new Error("no address to explore — set the application URL on the project");

  const budget = Math.max(1, Math.min(Number(params["pages"]) || 20, 200));
  const depth = Math.max(0, Math.min(Number(params["depth"]) || 3, 10));
  const login = params["signIn"] as SignIn | undefined;
  const perPatternLimit = Math.max(1, Number(params["perPattern"]) || PER_PATTERN);

  const origin = new URL(start).origin;
  const pages: Seen_Page[] = [];
  const skipped: string[] = [];
  const visited = new Set<string>();
  const perPattern = new Map<string, number>();
  let repeats = 0;

  let browser: Browser | null = null;
  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        detail.includes("Executable doesn't exist") || detail.includes("playwright install")
          ? "the browser this needs has not been downloaded yet — run: npx playwright install chromium"
          : `the browser would not start: ${detail}`,
      );
    }
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(start, { waitUntil: "domcontentloaded", timeout: 30_000 });

    if (login) {
      await signIn(page, login);
      log(`signed in, now at ${page.url()}`);
    }

    const queue: Array<{ url: string; depth: number; from: string | null }> = [
      { url: normalise(page.url()), depth: 0, from: null },
    ];

    while (queue.length > 0 && pages.length < budget) {
      const next = queue.shift()!;
      if (visited.has(next.url)) continue;

      // Judged before the visit, not after, because the cost this avoids
      // is the visit itself and the budget it would spend.
      const pattern = patternOf(next.url);
      const already = perPattern.get(pattern) ?? 0;
      if (already >= perPatternLimit) {
        repeats += 1;
        const template = pages.find((page) => page.pattern === pattern);
        if (template && template.examples.length < 20) template.examples.push(next.url);
        continue;
      }
      perPattern.set(pattern, already + 1);
      visited.add(next.url);

      try {
        if (normalise(page.url()) !== next.url) {
          await page.goto(next.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        }
        // Where it asked to go and where it arrived are not always the
        // same. Without this, two addresses that redirect to one page are
        // mapped as two pages with different contents.
        const landed = normalise(page.url());
        if (landed !== next.url && visited.has(landed)) continue;
        visited.add(landed);

        const seen = await readPage(page, next.from);
        pages.push(seen);

        if (next.depth < depth) {
          for (const link of seen.links) {
            // Same application only. A crawler that wanders off the origin
            // is loose on the internet with someone's session cookie.
            if (!link.startsWith(origin) || visited.has(link)) continue;
            queue.push({ url: link, depth: next.depth + 1, from: seen.url });
          }
        }
      } catch (error: unknown) {
        skipped.push(`${next.url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await browser?.close();
  }

  // Pages whose addresses differ but whose screens do not.
  const judge = (params["judge"] ?? {}) as Record<string, unknown>;
  const { pages: kept, folded } = await foldTemplates(pages, judge);

  const reached = kept.length;
  // A login page and an application that navigates with script both come
  // back as one page, and they need different advice. A door has fields
  // and a button and nowhere to go; guessing "script" at it would send
  // someone looking for a problem that is not there.
  const door =
    reached === 1 &&
    kept[0] !== undefined &&
    !login &&
    kept[0].elements.filter((element) => element.kind === "input").length >= 2 &&
    kept[0].elements.some((element) => element.kind === "control") &&
    kept[0].links.length <= 2;

  const scripted =
    !door &&
    reached === 1 &&
    kept[0] !== undefined &&
    kept[0].links.length < 4 &&
    kept[0].elements.filter((element) => element.kind !== "text").length >= 3;

  const sameAgain =
    repeats + folded > 0
      ? ` ${repeats + folded} addresses turned out to be a screen already mapped, so the budget went elsewhere.`
      : "";

  const note = door
    ? "Only one page, and it is the way in: fields and a button and nowhere to go. Set up the sign-in and the next run will go through it."
    : scripted
      ? "Only one page. This application moves between screens with script rather than links, and the explorer follows links — so what is behind a button has not been mapped."
      : reached >= budget
        ? `Stopped at the ${budget} page limit. Raise it to go further.${sameAgain}`
        : `${reached} pages, nothing clicked and no form submitted${login ? " apart from the sign-in" : ""}.${sameAgain}`;

  return { pages: kept, visited: visited.size, skipped, repeats, folded, note };
}
