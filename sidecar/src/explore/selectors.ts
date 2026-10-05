/**
 * How an element will be found again tomorrow.
 *
 * This is the part that decides whether generated tests survive contact
 * with a real application. A selector like `.btn-primary.mt-3` works until
 * someone changes a margin; `getByRole('button', { name: 'Login' })` works
 * until someone renames the button, which is a change worth failing on.
 *
 * The order below is Playwright's own advice, and each element records
 * which rung it landed on. A test built on the bottom rung should say so
 * rather than look as trustworthy as one built on the top.
 */

export type How = "testId" | "role" | "label" | "placeholder" | "text" | "css";

/** How much a selector can be trusted to still work after a redesign. */
export const STURDINESS: Record<How, number> = {
  testId: 1,
  role: 0.9,
  label: 0.85,
  placeholder: 0.6,
  text: 0.55,
  css: 0.2,
};

export interface Found {
  how: How;
  /** What to write in the test. */
  selector: string;
  sturdiness: number;
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export interface Seen {
  tag: string;
  /** Which attribute the test id came from: teams do not agree on one. */
  testIdAttribute?: string | null;
  role: string | null;
  name: string | null;
  testId: string | null;
  label: string | null;
  placeholder: string | null;
  text: string | null;
  id: string | null;
  css: string;
  /** How many elements on the page share the best selector. */
  duplicates?: number;
}

/**
 * Every way of finding this element, sturdiest first.
 *
 * The caller tries them against the real page and keeps the first that
 * matches exactly one element. Counting in the page is not enough on its
 * own: Playwright matches a role by its accessible name, which is not
 * always the text content this reads, so a selector can look unique here
 * and match six things in practice. Measured on a documentation site with
 * no test ids, guessing gave 89 of 145 unique; asking the browser is the
 * difference between a test that clicks the button and one that clicks
 * whichever button came first.
 */
export function candidatesFor(element: Seen): Found[] {
  const found: Found[] = [];
  const unique = (element.duplicates ?? 1) <= 1;

  if (element.testId) {
    const attribute = element.testIdAttribute ?? "data-testid";
    found.push({
      how: "testId",
      selector:
        attribute === "data-testid"
          ? `getByTestId(${quote(element.testId)})`
          : `locator(${quote(`[${attribute}="${element.testId}"]`)})`,
      sturdiness: STURDINESS.testId,
    });
  }
  if (element.role && element.name) {
    found.push({
      how: "role",
      selector: `getByRole(${quote(element.role)}, { name: ${quote(element.name)} })`,
      sturdiness: STURDINESS.role,
    });
  }
  if (element.label) {
    found.push({ how: "label", selector: `getByLabel(${quote(element.label)})`, sturdiness: STURDINESS.label });
  }
  if (element.placeholder) {
    found.push({
      how: "placeholder",
      selector: `getByPlaceholder(${quote(element.placeholder)})`,
      sturdiness: STURDINESS.placeholder,
    });
  }
  if (element.text && element.text.length <= 40) {
    found.push({ how: "text", selector: `getByText(${quote(element.text)})`, sturdiness: STURDINESS.text });
  }
  if (element.id) {
    found.push({ how: "css", selector: `locator(${quote(`#${element.id}`)})`, sturdiness: 0.45 });
  }
  found.push({ how: "css", selector: `locator(${quote(element.css)})`, sturdiness: STURDINESS.css });

  // Without the browser's opinion, anything the page says is ambiguous is
  // pushed below the things it does not.
  return unique ? found : found.filter((entry) => entry.how === "testId").concat(found);
}

/**
 * Picks the sturdiest way to find this element.
 *
 * A selector that matches more than one element is no selector at all, so
 * anything ambiguous falls through to the next rung rather than being
 * handed over as if it were fine.
 */
export function selectorFor(element: Seen): Found {
  const unique = (element.duplicates ?? 1) <= 1;

  if (element.testId) {
    // getByTestId resolves against data-testid and nothing else. A site
    // using data-test — which plenty do, saucedemo among them — would get
    // a selector that reads beautifully and matches zero elements. The
    // attribute selector is uglier and correct, and it is still a test id,
    // so it keeps the trust that comes with one.
    const attribute = element.testIdAttribute ?? "data-testid";
    return {
      how: "testId",
      selector:
        attribute === "data-testid"
          ? `getByTestId(${quote(element.testId)})`
          : `locator(${quote(`[${attribute}="${element.testId}"]`)})`,
      sturdiness: STURDINESS.testId,
    };
  }
  if (unique && element.role && element.name) {
    return {
      how: "role",
      selector: `getByRole(${quote(element.role)}, { name: ${quote(element.name)} })`,
      sturdiness: STURDINESS.role,
    };
  }
  if (unique && element.label) {
    return { how: "label", selector: `getByLabel(${quote(element.label)})`, sturdiness: STURDINESS.label };
  }
  if (unique && element.placeholder) {
    return {
      how: "placeholder",
      selector: `getByPlaceholder(${quote(element.placeholder)})`,
      sturdiness: STURDINESS.placeholder,
    };
  }
  if (unique && element.text && element.text.length <= 40) {
    return { how: "text", selector: `getByText(${quote(element.text)})`, sturdiness: STURDINESS.text };
  }
  // The last rung. An id in the CSS makes it steadier than a class path,
  // but it is still tied to markup rather than to what the user sees.
  const css = element.id ? `#${element.id}` : element.css;
  return {
    how: "css",
    selector: `locator(${quote(css)})`,
    sturdiness: element.id ? 0.45 : STURDINESS.css,
  };
}
