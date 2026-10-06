import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { atomicWrite, slugify } from "./paths.js";

describe("naming a folder from what someone typed", () => {
  it("makes a safe name", () => {
    assert.equal(slugify("Metrolinx PRESTO App"), "metrolinx-presto-app");
    assert.equal(slugify("  Fare / Rules  "), "fare-rules");
  });

  it("never returns nothing", () => {
    // A name of only punctuation would otherwise produce an empty path.
    assert.equal(slugify("...."), "project");
    assert.equal(slugify(""), "project");
  });

  it("cannot climb out of its folder", () => {
    assert.equal(slugify("../../etc/passwd"), "etc-passwd");
  });
});

describe("writing a record", () => {
  it("lands whole, and leaves nothing behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-paths-"));
    const target = join(dir, "sub", "thing.yaml");

    atomicWrite(target, "one: 1\n");
    assert.equal(readFileSync(target, "utf8"), "one: 1\n");

    atomicWrite(target, "two: 2\n");
    assert.equal(readFileSync(target, "utf8"), "two: 2\n");

    const leftovers = readdirSync(join(dir, "sub")).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, [], "a temporary file must never be mistaken for a record");

    rmSync(dir, { recursive: true, force: true });
  });

  it("makes the folder it needs", () => {
    const dir = mkdtempSync(join(tmpdir(), "ti-paths-"));
    const target = join(dir, "a", "b", "c.yaml");
    atomicWrite(target, "x: 1\n");
    assert.ok(existsSync(target));
    rmSync(dir, { recursive: true, force: true });
  });
});
