import type { Locator, Page } from "playwright";

/**
 * Turning a stored selector back into something Playwright can use.
 *
 * The map stores selectors as the text a test would contain —
 * `getByRole('button', { name: 'Login' })` — because that is what makes
 * generated code readable. Running one means turning that text back into a
 * call.
 *
 * It is parsed against a fixed list of forms, never evaluated. A selector
 * read off a page is untrusted input, and `eval` would turn a page's own
 * markup into code running on this machine.
 */

export type Kind = "getByTestId" | "getByRole" | "getByLabel" | "getByPlaceholder" | "getByText" | "locator";

const KINDS: Kind[] = [
  "getByTestId",
  "getByRole",
  "getByLabel",
  "getByPlaceholder",
  "getByText",
  "locator",
];

export interface Parsed {
  kind: Kind;
  value: string;
  /** Only for getByRole. */
  name?: string;
}

/** Reads one single-quoted string, honouring backslash escapes. */
function readQuoted(text: string, from: number): { value: string; next: number } | null {
  if (text[from] !== "'") return null;
  let value = "";
  for (let at = from + 1; at < text.length; at += 1) {
    const char = text[at]!;
    if (char === "\\") {
      value += text[at + 1] ?? "";
      at += 1;
    } else if (char === "'") {
      return { value, next: at + 1 };
    } else {
      value += char;
    }
  }
  return null;
}

export function parse(expression: string): Parsed {
  const text = expression.trim();
  const kind = KINDS.find((candidate) => text.startsWith(`${candidate}(`));
  if (!kind) throw new Error(`not a selector this app writes: ${expression.slice(0, 60)}`);

  const first = readQuoted(text, kind.length + 1);
  if (!first) throw new Error(`could not read the selector: ${expression.slice(0, 60)}`);

  if (kind !== "getByRole") {
    return { kind, value: first.value };
  }

  const rest = text.slice(first.next);
  const at = rest.indexOf("name:");
  if (at === -1) return { kind, value: first.value };

  const named = readQuoted(rest, rest.indexOf("'", at));
  return { kind, value: first.value, ...(named ? { name: named.value } : {}) };
}

export function locate(page: Page, expression: string): Locator {
  const parsed = parse(expression);
  switch (parsed.kind) {
    case "getByTestId":
      return page.getByTestId(parsed.value);
    case "getByRole":
      return page.getByRole(
        parsed.value as Parameters<Page["getByRole"]>[0],
        parsed.name === undefined ? undefined : { name: parsed.name },
      );
    case "getByLabel":
      return page.getByLabel(parsed.value);
    case "getByPlaceholder":
      return page.getByPlaceholder(parsed.value);
    case "getByText":
      return page.getByText(parsed.value);
    default:
      return page.locator(parsed.value);
  }
}
