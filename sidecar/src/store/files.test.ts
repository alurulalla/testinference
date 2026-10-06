import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { Records } from "./files.js";
import { folder } from "./paths.js";

interface Thing {
  id: string;
  title: string;
  note?: string | null;
}

const things = new Records<Thing>("things", { note: null });
const project = () => mkdtempSync(join(tmpdir(), "ti-store-"));

describe("one record, one file", () => {
  it("saves and reads back", () => {
    const dir = project();
    things.save(dir, { id: "A-1", title: "The first one" });
    assert.deepEqual(things.get(dir, "A-1"), { id: "A-1", title: "The first one", note: null });
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists in id order, whatever order the files came in", () => {
    const dir = project();
    for (const id of ["A-3", "A-1", "A-2"]) things.save(dir, { id, title: id });
    assert.deepEqual(things.list(dir).map((t) => t.id), ["A-1", "A-2", "A-3"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fills in a field a file written by an older version lacks", () => {
    const dir = project();
    mkdirSync(folder(dir, "things"), { recursive: true });
    writeFileSync(join(folder(dir, "things"), "A-1.yaml"), "id: A-1\ntitle: Old\n");
    // The whole class of bug this replaces: a field added later must not
    // make every existing record unreadable.
    assert.deepEqual(things.get(dir, "A-1"), { id: "A-1", title: "Old", note: null });
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a file it cannot read rather than pretending it is absent", () => {
    const dir = project();
    things.save(dir, { id: "A-1", title: "Fine" });
    mkdirSync(folder(dir, "things"), { recursive: true });
    writeFileSync(join(folder(dir, "things"), "A-2.yaml"), "id: [unclosed\n");

    assert.equal(things.list(dir).length, 1, "the good one still reads");
    assert.equal(things.unreadable(dir).length, 1, "and the broken one is named");
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes something a person can read in a diff", () => {
    const dir = project();
    things.save(dir, { id: "A-1", title: "Search returns results in under 400ms" });
    const text = readFileSync(join(folder(dir, "things"), "A-1.yaml"), "utf8");
    assert.ok(text.includes("title: Search returns results in under 400ms"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("cannot be made to write outside its folder", () => {
    const dir = project();
    things.save(dir, { id: "../../escaped", title: "No" });
    assert.equal(things.count(dir), 1, "it stays in the folder");
    assert.deepEqual(things.list(dir).map((t) => t.title), ["No"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("empties the folder but keeps it", () => {
    const dir = project();
    things.save(dir, { id: "A-1", title: "One" });
    things.clear(dir);
    assert.equal(things.count(dir), 0);
    things.save(dir, { id: "A-2", title: "Two" });
    assert.equal(things.count(dir), 1);
    rmSync(dir, { recursive: true, force: true });
  });
});
