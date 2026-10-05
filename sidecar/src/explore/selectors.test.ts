import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { selectorFor, type Seen } from "./selectors.js";

const bare: Seen = {
  tag: "button",
  role: null,
  name: null,
  testId: null,
  label: null,
  placeholder: null,
  text: null,
  id: null,
  css: "div.wrap > button.btn.btn-primary",
};

describe("choosing how to find an element again", () => {
  it("prefers a test id over everything, because that is what it is for", () => {
    const found = selectorFor({
      ...bare,
      testId: "login-button",
      testIdAttribute: "data-testid",
      role: "button",
      name: "Login",
    });
    assert.equal(found.how, "testId");
    assert.equal(found.selector, "getByTestId('login-button')");
  });

  it("does not write getByTestId for a site that uses a different attribute", () => {
    // getByTestId resolves against data-testid alone. On a site using
    // data-test it reads perfectly and matches nothing, which is the worst
    // kind of wrong.
    const found = selectorFor({ ...bare, testId: "username", testIdAttribute: "data-test" });
    assert.equal(found.how, "testId");
    assert.equal(found.selector, `locator('[data-test="username"]')`);
    assert.equal(found.sturdiness, 1, "it is still a test id and still trustworthy");
  });

  it("falls to role and name, which survive a redesign", () => {
    const found = selectorFor({ ...bare, role: "button", name: "Login" });
    assert.equal(found.selector, "getByRole('button', { name: 'Login' })");
    assert.ok(found.sturdiness > 0.8);
  });

  it("refuses a selector that matches more than one element", () => {
    const found = selectorFor({ ...bare, role: "button", name: "Add to cart", duplicates: 6 });
    // Six "Add to cart" buttons is the normal case on a product list, and
    // handing back a selector that matches all six would be a test that
    // clicks whichever one Playwright saw first.
    assert.equal(found.how, "css");
  });

  it("uses an id when there is nothing better, and says it is weaker", () => {
    const strong = selectorFor({ ...bare, role: "button", name: "Login" });
    const weak = selectorFor({ ...bare, id: "login-button" });
    assert.equal(weak.selector, "locator('#login-button')");
    assert.ok(weak.sturdiness < strong.sturdiness);
  });

  it("lands on a class path only when nothing else exists, and scores it low", () => {
    const found = selectorFor(bare);
    assert.equal(found.how, "css");
    assert.ok(found.sturdiness <= 0.2, "a class path should never look trustworthy");
  });

  it("escapes a name containing a quote rather than producing broken code", () => {
    const found = selectorFor({ ...bare, role: "button", name: "Don't save" });
    assert.equal(found.selector, "getByRole('button', { name: 'Don\\'t save' })");
  });
});
