import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { fileFor, lineFor, specFor, type Line } from "./render.js";

const control = {
  page: "https://shop.test/",
  role: "button",
  name: "Login",
  selector: "getByRole('button', { name: 'Login' })",
  kind: "control",
  matches: 1,
  sturdiness: 0.9,
};
const sure = { control, confidence: 0.95, why: "", by: "jev" as const };
const nothing = { control: null, confidence: 0, why: "no control matched", by: "jev" as const };

describe("writing a line of test code", () => {
  it("fills a field with the value the step gave", () => {
    const line = lineFor(
      { from: "Enter standard_user", action: "fill", target: "the username field", value: "standard_user" },
      { ...sure, control: { ...control, kind: "input" } },
      "https://shop.test/",
    );
    assert.equal(line.code, `await page.getByRole('button', { name: 'Login' }).fill("standard_user");`);
  });

  it("says which one when the selector matches several", () => {
    const line = lineFor(
      { from: "Add to cart", action: "click", target: "the add button", value: "" },
      { ...sure, control: { ...control, matches: 6 } },
      "https://shop.test/",
    );
    // Six matching buttons without .first() is a test that acts on
    // whichever the browser reached first.
    assert.ok(line.code?.includes(".first().click()"));
  });

  it("writes no code when nothing matched, and says why", () => {
    const line = lineFor(
      { from: "Press the gadget", action: "click", target: "the gadget", value: "" },
      nothing,
      "https://shop.test/",
    );
    assert.equal(line.code, null);
    assert.equal(line.problem, "no control matched");
  });

  it("keeps a step a browser cannot do, rather than dropping it", () => {
    const line = lineFor(
      { from: "Check the confirmation email", action: "click", target: "CANNOT: needs an inbox", value: "" },
      nothing,
      "https://shop.test/",
    );
    assert.equal(line.code, null);
    assert.equal(line.problem, "needs an inbox");
  });
});

describe("writing the file", () => {
  const ok: Line[] = [
    { from: "Click Login", code: "await page.getByRole('button').click();", problem: null, confidence: 0.9 },
    { from: "The dashboard appears", code: 'await expect(page).toHaveURL("/dash");', problem: null, confidence: 0.9 },
  ];

  it("lets a complete test run", () => {
    const spec = specFor({ id: "TC-1", title: "Log in" }, ok, "https://shop.test/");
    const file = fileFor([spec], "https://shop.test/", "run-1");
    assert.ok(file.includes('test("TC-1 · Log in"'), "it should be a plain test");
    assert.ok(!file.includes("test.fixme"));
  });

  it("refuses to let a test with no check pass", () => {
    const noCheck: Line[] = [ok[0]!];
    const spec = specFor({ id: "TC-2", title: "Click about" }, noCheck, "https://shop.test/");
    const file = fileFor([spec], "https://shop.test/", "run-1");
    // A green tick that asserts nothing is worse than no test: it buys
    // confidence nobody has earned and nobody looks again.
    assert.ok(file.includes("test.fixme"));
    assert.ok(file.includes("nothing in the expected result could be turned into a check"));
  });

  it("refuses to let a test with a missing step pass", () => {
    const broken: Line[] = [
      ...ok,
      { from: "Press the gadget", code: null, problem: "no control matched", confidence: 0 },
    ];
    const spec = specFor({ id: "TC-3", title: "Gadget" }, broken, "https://shop.test/");
    const file = fileFor([spec], "https://shop.test/", "run-1");
    assert.ok(file.includes("test.fixme"));
    assert.ok(file.includes("TODO: no control matched"));
  });

  it("keeps each step's own words beside the code", () => {
    const spec = specFor({ id: "TC-4", title: "Log in" }, ok, "https://shop.test/");
    const file = fileFor([spec], "https://shop.test/", "run-1");
    assert.ok(file.includes("// Click Login"), "the step a person wrote stays visible");
  });

  it("marks a control it was unsure about", () => {
    const shaky: Line[] = [
      { from: "Click it", code: "await page.getByRole('button').click();", problem: null, confidence: 0.4 },
      ok[1]!,
    ];
    const spec = specFor({ id: "TC-5", title: "Unsure" }, shaky, "https://shop.test/");
    assert.ok(fileFor([spec], "https://shop.test/", "run-1").includes("unsure this is the right control"));
  });
});
