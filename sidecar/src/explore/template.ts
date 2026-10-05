import { fanOut } from "../decisions/fanout.js";
import { isYes } from "../decisions/jev.js";

/**
 * One screen, seen forty times.
 *
 * A shop has `/product/1` through `/product/40`. They are not forty pages;
 * they are one page showing different data, with identical controls. Left
 * alone they do real damage: a twenty page budget is spent entirely on
 * products, and the basket and the checkout — the screens anyone actually
 * wants tested — are never reached.
 *
 * Two mechanisms, because they catch different things. The address pattern
 * is cheap and works before a page is visited, which is what saves the
 * budget. The shape of a page catches the ones whose addresses look
 * nothing alike, and is only known after looking.
 */

/** Looks like an identifier rather than a name. */
function isIdentifier(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8,}$/i.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  // A slug with a number on the end, as in "blue-shirt-4821".
  if (/^[a-z0-9-]+-\d{3,}$/i.test(segment)) return true;
  return false;
}

/**
 * The address with its identifiers taken out, so `/product/1` and
 * `/product/2` come out the same.
 */
export function patternOf(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .split("/")
      .map((segment) => (isIdentifier(segment) ? "{}" : segment))
      .join("/");
    // A query value is data; which parameters are present is structure.
    const query = [...parsed.searchParams.keys()].sort().join(",");
    return `${parsed.origin}${path}${query ? `?${query}` : ""}`;
  } catch {
    return url;
  }
}

export interface Shaped {
  role: string | null;
  kind: string;
  how: string;
}

/**
 * What a page is made of, with the words left out.
 *
 * Two product pages differ in every name on them and in nothing else, so
 * a fingerprint that includes the names says they are different pages and
 * a fingerprint that leaves them out says they are the same.
 */
export function shapeOf(elements: Shaped[]): string {
  const text = elements
    .filter((element) => element.kind !== "text")
    .map((element) => `${element.kind}:${element.role ?? "?"}`)
    .sort()
    .join("|");

  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export interface Groupable {
  url: string;
  title: string;
  pattern: string;
  shape: string;
  examples: string[];
}

const SAME_SCREEN = {
  true: "The same screen showing different data: a product page for two products, a profile for two people. The controls are the same and only the content differs.",
  false: "Different screens. One does something the other does not — different controls, a different purpose, a different part of the application.",
};

/**
 * Folds pages that are one screen into one entry.
 *
 * The rules group by address pattern and by shape. The judge is asked only
 * about groups the rules formed, and only when it is available: being
 * wrong here costs a page in the map, not a test, so the rules standing
 * alone is an acceptable answer.
 */
export async function foldTemplates<T extends Groupable>(
  pages: T[],
  judge: Record<string, unknown>,
): Promise<{ pages: T[]; folded: number; asked: number }> {
  const groups = new Map<string, T[]>();
  for (const page of pages) {
    // Same address pattern, same shape: two reasons to think one screen.
    const key = `${page.pattern}\u0000${page.shape}`;
    const existing = groups.get(key);
    if (existing) existing.push(page);
    else groups.set(key, [page]);
  }

  const candidates = [...groups.values()].filter((group) => group.length > 1);
  if (candidates.length === 0) return { pages, folded: 0, asked: 0 };

  // With a judge, each group is confirmed before it is folded.
  let confirmed = candidates;
  let asked = 0;
  const key = typeof judge["key"] === "string" ? judge["key"] : "";
  if (judge["mode"] === "jev" && key) {
    const units = candidates.map((group, at) => ({
      state: {
        [`first_${at}`]: { address: group[0]!.url, title: group[0]!.title },
        [`second_${at}`]: { address: group[1]!.url, title: group[1]!.title },
      },
      question: {
        type: "noul" as const,
        instructions: `Are \`first_${at}\` and \`second_${at}\` the same screen showing different data?`,
        criteria: SAME_SCREEN,
      },
    }));

    const out = await fanOut(
      {
        key,
        endpoint: typeof judge["endpoint"] === "string" ? judge["endpoint"] : null,
        model: typeof judge["model"] === "string" ? judge["model"] : null,
      },
      units,
      Number(judge["atOnce"]) || 4,
    );
    asked = out.answers.size;

    confirmed = candidates.filter((_group, at) => {
      const answer = out.answers.get(at);
      // No answer leaves the rules' grouping standing: they had two
      // reasons to think these are one screen.
      if (!answer || answer.noul === undefined) return true;
      return isYes(answer.noul);
    });
  }

  const folding = new Set(confirmed.map((group) => group[0]!.url));
  const dropped = new Set(confirmed.flatMap((group) => group.slice(1).map((page) => page.url)));

  const kept = pages
    .filter((page) => !dropped.has(page.url))
    .map((page) => {
      if (!folding.has(page.url)) return page;
      const group = confirmed.find((entry) => entry[0]!.url === page.url)!;
      return { ...page, examples: [...page.examples, ...group.slice(1).map((other) => other.url)] };
    });

  return { pages: kept, folded: dropped.size, asked };
}
