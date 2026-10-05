import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parse } from "./resolve.js";

describe("reading a stored selector back", () => {
  it("reads a test id", () => {
    assert.deepEqual(parse("getByTestId('username')"), { kind: "getByTestId", value: "username" });
  });

  it("reads a role and its name", () => {
    assert.deepEqual(parse("getByRole('button', { name: 'Login' })"), {
      kind: "getByRole",
      value: "button",
      name: "Login",
    });
  });

  it("reads a role with no name", () => {
    assert.deepEqual(parse("getByRole('navigation')"), { kind: "getByRole", value: "navigation" });
  });

  it("puts an escaped quote back as it was", () => {
    assert.deepEqual(parse("getByRole('button', { name: 'Don\\'t save' })"), {
      kind: "getByRole",
      value: "button",
      name: "Don't save",
    });
  });

  it("reads a css fallback", () => {
    assert.deepEqual(parse("locator('#login-button')"), { kind: "locator", value: "#login-button" });
  });

  it("refuses anything it did not write", () => {
    // A selector comes from a page's own markup, so this is the boundary
    // between data and code. Nothing is evaluated; anything unfamiliar is
    // refused rather than attempted.
    assert.throws(() => parse("process.exit(1)"), /not a selector/);
    assert.throws(() => parse("page.evaluate('alert(1)')"), /not a selector/);
    assert.throws(() => parse("getByTestId(require('fs'))"), /could not read/);
  });
});
