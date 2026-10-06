import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

let area: string;
let extract: typeof import("./extract.js");
let store: typeof import("../store/index.js");
let chunks: typeof import("../store/chunks.js");
let project: typeof import("../store/project.js");

before(async () => {
  area = mkdtempSync(join(tmpdir(), "ti-extract-"));
  process.env["TESTINFERENCE_DATA_DIR"] = area;
  [extract, store, chunks, project] = await Promise.all([
    import("./extract.js"),
    import("../store/index.js"),
    import("../store/chunks.js"),
    import("../store/project.js"),
  ]);
});

after(() => {
  delete process.env["TESTINFERENCE_DATA_DIR"];
  rmSync(area, { recursive: true, force: true });
});

/** A project with one document cut into the pieces given. */
function withPieces(name: string, texts: string[]) {
  const made = project.createProject(name, "");
  store.documents.save(made.path, {
    id: "doc", name: "spec.md", kind: "markdown", pages: null,
    chunks: texts.length, bytes: 0, fingerprint: "f", addedAt: store.now(), warning: null,
  });
  chunks.write(
    made.id,
    "doc",
    texts.map((text, block) => ({ hash: chunks.fingerprint(text), text, page: null, block })),
  );
  return made;
}

/** A requirement that came from a given piece, as a run would have left it. */
function requirementFrom(path: string, id: string, piece: string, approved = false) {
  store.requirements.save(path, {
    id, title: `From ${piece}`, acceptance: "something", domain: "", impacted: "",
    flag: "clear", version: 1, asExtracted: null, clarification: null,
    source: { document: "spec.md", page: null, block: 0, piece },
    madeBy: { run: "run-001", model: "m", prompt: "p", attempt: 1 },
    editedBy: approved ? ["discussed once"] : [], orphaned: false,
  });
}

describe("deciding what a re-read would actually do", () => {
  it("treats everything as new the first time", () => {
    const made = withPieces("First read", ["one", "two", "three"]);
    const delta = extract.plan(made.path);

    assert.equal(delta.firstRun, true);
    assert.equal(delta.newPieces, 3);
    assert.match(delta.note, /nothing has been read yet/);
  });

  it("costs nothing and keeps everything when the document has not changed", () => {
    const made = withPieces("Unchanged", ["one", "two"]);
    const pieces = extract.gather(made.path).map((piece) => piece.hash);
    store.runs.save(made.path, {
      id: "run-001", kind: "extract", startedAt: store.now(), finishedAt: store.now(),
      status: "finished", model: "m", prompt: "p", batches: 1, batchesDone: 1, attempts: 1,
      inputTokens: 0, outputTokens: 0, cost: null, produced: 2, note: null,
      judge: "rules", pieces,
    });
    for (const [at, hash] of pieces.entries()) requirementFrom(made.path, `REQ-0${at + 1}`, hash);

    const delta = extract.plan(made.path);
    assert.equal(delta.newPieces, 0);
    assert.equal(delta.keep, 2);
    assert.equal(delta.estimate.units, 0);
    // The important promise: a re-read of an unchanged document must not
    // cost money or throw away a week of review.
    assert.match(delta.note, /nothing has changed/);
  });

  it("sees only the piece that changed, and keeps the rest", () => {
    const made = withPieces("One edit", ["one", "two", "three"]);
    const before = extract.gather(made.path).map((piece) => piece.hash);
    store.runs.save(made.path, {
      id: "run-001", kind: "extract", startedAt: store.now(), finishedAt: store.now(),
      status: "finished", model: "m", prompt: "p", batches: 1, batchesDone: 1, attempts: 1,
      inputTokens: 0, outputTokens: 0, cost: null, produced: 3, note: null,
      judge: "rules", pieces: before,
    });
    for (const [at, hash] of before.entries()) requirementFrom(made.path, `REQ-0${at + 1}`, hash);

    // The second paragraph is edited; the other two are untouched.
    chunks.write(made.id, "doc", ["one", "two, but longer", "three"].map((text, block) => ({
      hash: chunks.fingerprint(text), text, page: null, block,
    })));

    const delta = extract.plan(made.path);
    assert.equal(delta.newPieces, 1, "only the edited paragraph is re-read");
    assert.equal(delta.gonePieces, 1, "and its old version is gone");
    assert.equal(delta.keep, 2, "the other two requirements stay");
    assert.equal(delta.orphaned, 1, "the one from the old text is flagged, not deleted");
  });

  it("flags a requirement whose paragraph was deleted rather than removing it", () => {
    const made = withPieces("Deleted", ["one", "two"]);
    const before = extract.gather(made.path).map((piece) => piece.hash);
    store.runs.save(made.path, {
      id: "run-001", kind: "extract", startedAt: store.now(), finishedAt: store.now(),
      status: "finished", model: "m", prompt: "p", batches: 1, batchesDone: 1, attempts: 1,
      inputTokens: 0, outputTokens: 0, cost: null, produced: 2, note: null,
      judge: "rules", pieces: before,
    });
    requirementFrom(made.path, "REQ-01", before[0]!);
    requirementFrom(made.path, "REQ-02", before[1]!, true);

    chunks.write(made.id, "doc", [{ hash: chunks.fingerprint("one"), text: "one", page: null, block: 0 }]);

    const delta = extract.plan(made.path);
    assert.equal(delta.orphaned, 1);
    assert.equal(store.requirements.list(made.path).length, 2, "nothing is deleted by planning");
  });
});
