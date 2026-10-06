import { execFileSync } from "node:child_process";

import { CONTEXT_DIR } from "./paths.js";

/**
 * Just enough git to tell someone whether their work is safe.
 *
 * The app does not manage branches or history. It answers one question —
 * is what this project knows committed and pushed? — and offers to do it
 * when the answer is no.
 */

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  /** Everything changed in the repository. */
  changed: number;
  /** Changed inside the project's own folder, which is what we wrote. */
  contextChanged: number;
  hasRemote: boolean;
}

function git(projectPath: string, args: string[]): string {
  return execFileSync("git", ["-C", projectPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(projectPath: string, args: string[]): string | null {
  try {
    return git(projectPath, args);
  } catch {
    return null;
  }
}

export function status(projectPath: string): GitStatus {
  if (tryGit(projectPath, ["rev-parse", "--is-inside-work-tree"]) === null) {
    return { isRepo: false, branch: null, changed: 0, contextChanged: 0, hasRemote: false };
  }

  const lines = (tryGit(projectPath, ["status", "--porcelain"]) ?? "")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  return {
    isRepo: true,
    branch: tryGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
    changed: lines.length,
    contextChanged: lines.filter((line) => line.includes(CONTEXT_DIR)).length,
    hasRemote: (tryGit(projectPath, ["remote"]) ?? "").length > 0,
  };
}

export interface GitResult {
  committed: boolean;
  pushed: boolean;
  detail: string;
}

/**
 * Commits the generated tests, and the project context too if asked.
 *
 * Without `includeContext` everything except the context folder is
 * staged, because the person may want the tests in one commit and what
 * the app learned in another. With it, only the context folder is.
 */
export function commit(
  projectPath: string,
  message: string,
  includeContext: boolean,
  push: boolean,
): GitResult {
  if (tryGit(projectPath, ["rev-parse", "--is-inside-work-tree"]) === null) {
    throw new Error("this project folder is not a git repository");
  }

  if (includeContext) {
    git(projectPath, ["add", CONTEXT_DIR]);
  } else {
    // Stage everything except the context folder.
    git(projectPath, ["add", "--all", "--", `:!${CONTEXT_DIR}`]);
  }

  const staged = git(projectPath, ["diff", "--cached", "--name-only"]);
  if (staged.trim().length === 0) {
    return { committed: false, pushed: false, detail: "nothing to commit" };
  }

  git(projectPath, ["commit", "-m", message]);
  const count = staged.split("\n").filter((line) => line.trim().length > 0).length;

  if (!push) {
    return { committed: true, pushed: false, detail: `committed ${count} files — not pushed` };
  }

  try {
    git(projectPath, ["push"]);
    return { committed: true, pushed: true, detail: `committed and pushed ${count} files` };
  } catch (error) {
    return {
      committed: true,
      pushed: false,
      detail: `committed ${count} files, but the push failed: ${describe(error)}`,
    };
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // git puts the useful part on stderr, which execFileSync hides here.
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    const detail = stderr ? String(stderr).trim() : error.message;
    return detail.split("\n")[0] ?? error.message;
  }
  return String(error);
}
