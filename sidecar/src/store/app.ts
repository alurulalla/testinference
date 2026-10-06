import { homedir, platform } from "node:os";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { atomicWrite } from "./paths.js";

/**
 * Where the application keeps what belongs to the machine rather than to
 * a project: the list of projects, the settings, the document index.
 *
 * Worked out here rather than passed in from the shell, so the worker can
 * be run on its own — by a test, or from a terminal — without a window
 * having to tell it where it lives. The override exists for exactly that.
 */
const NAME = "dev.testinference.desktop";

export function appDir(): string {
  const given = process.env["TESTINFERENCE_DATA_DIR"];
  if (given) return given;

  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", NAME);
    case "win32":
      return join(process.env["APPDATA"] ?? join(home, "AppData", "Roaming"), NAME);
    default:
      return join(process.env["XDG_DATA_HOME"] ?? join(home, ".local", "share"), NAME);
  }
}

/** Where projects live when the person does not choose a folder of their own. */
export function projectsRoot(): string {
  return join(appDir(), "projects");
}

export function registryPath(): string {
  return join(appDir(), "projects.json");
}

export function configPath(): string {
  return join(appDir(), "config.json");
}

/** The chunk index and other large per-project data, kept out of git. */
export function localDir(projectId: string, kind: string): string {
  const dir = join(appDir(), kind, projectId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // A corrupt settings file should not stop the app opening.
    return fallback;
  }
}

export function writeJson(path: string, value: unknown): void {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}
