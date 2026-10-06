import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { folder } from "./paths.js";
import { read, write } from "./steps.js";

describe("the step library", () => {
  it("reads back what it wrote, in the order it was given", () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-steps-"));
    const steps = ["Click the Login button", "Enter a valid username", "Open the cart page"];
    write(dir, steps);
    // Order is how steps were added. Sorting would make the first write
    // after any change look like the whole file was rewritten.
    assert.deepEqual(read(dir), steps);
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the file the rest of the app already has on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-steps-"));
    write(dir, ["Click Pay"]);
    // Not library.txt. Changing the name would read every existing
    // library as empty and start collecting again from nothing.
    const text = readFileSync(join(folder(dir, "steps"), "library.yaml"), "utf8");
    assert.match(text, /- Click Pay/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("is empty rather than broken when there is no library yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-steps-"));
    assert.deepEqual(read(dir), []);
    rmSync(dir, { recursive: true, force: true });
  });
});
