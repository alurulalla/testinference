import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { contextDir } from "./paths.js";

/** Its own app folder, so a test never touches the real project list. */
let area: string;
let project: typeof import("./project.js");

before(async () => {
  area = mkdtempSync(join(tmpdir(), "ti-app-"));
  process.env["TESTINFERENCE_DATA_DIR"] = area;
  project = await import("./project.js");
});

after(() => {
  delete process.env["TESTINFERENCE_DATA_DIR"];
  rmSync(area, { recursive: true, force: true });
});

describe("a project", () => {
  it("is a folder with everything laid out, empty or not", () => {
    const made = project.createProject("Sample project", "https://example.com");
    assert.equal(made.id, "sample-project");
    assert.ok(existsSync(contextDir(made.path)));
    assert.ok(made.counts.some((count) => count.folder === "requirements"));
    assert.ok(made.counts.every((count) => count.files === 0));
  });

  it("is on the list once, however many times it is saved", () => {
    project.createProject("Only once", "");
    project.editProject(join(area, "projects", "only-once"), "Only once", "https://x.test");
    assert.equal(project.listProjects().filter((p) => p.id === "only-once").length, 1);
  });

  it("renames its folder when it lives in the app's own area", () => {
    const made = project.createProject("Before", "");
    const renamed = project.editProject(made.path, "After", "");
    assert.ok(renamed.path.endsWith("after"), renamed.path);
    assert.ok(!existsSync(made.path), "the old folder is gone");
    assert.equal(project.readContext(renamed.path).name, "After");
  });

  it("keeps a folder the person chose, whatever the project is renamed to", () => {
    const chosen = mkdtempSync(join(tmpdir(), "my-repo-"));
    const made = project.createProject("In my repo", "", chosen);
    const renamed = project.editProject(made.path, "Renamed", "");
    // Moving someone's checkout because they renamed a project would be
    // a surprising thing for a test tool to do.
    assert.equal(renamed.path, chosen);
    rmSync(chosen, { recursive: true, force: true });
  });

  it("refuses a judgement mode it does not have", () => {
    const made = project.createProject("Judging", "");
    assert.equal(project.readContext(made.path).judgeMode, "rules");
    project.setJudgeMode(made.path, "jev");
    assert.equal(project.readContext(made.path).judgeMode, "jev");
    assert.throws(() => project.setJudgeMode(made.path, "vibes"), /no judgement mode/);
    assert.equal(project.readContext(made.path).judgeMode, "jev", "and it is left as it was");
  });

  it("forgets a project without touching its files", () => {
    const made = project.createProject("Keep the files", "");
    const removed = project.removeProject(made.path, false);
    assert.equal(removed.trashed, null);
    assert.ok(existsSync(contextDir(made.path)), "the folder is still there");
    assert.equal(project.listProjects().filter((p) => p.id === "keep-the-files").length, 0);
  });

  it("drops a project whose folder has gone, rather than listing a dead one", () => {
    const made = project.createProject("Vanishing", "");
    rmSync(made.path, { recursive: true, force: true });
    assert.equal(project.listProjects().filter((p) => p.id === "vanishing").length, 0);
  });
});
