import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";

import { projectsRoot, readJson, registryPath, writeJson } from "./app.js";
import { Records } from "./files.js";
import { atomicWrite, contextDir, FOLDERS, folder, slugify } from "./paths.js";
import { now } from "./records.js";

/**
 * A project: a folder, and everything the app has learned about it.
 *
 * The folder is the truth. The registry is only a list of where to look,
 * and a project whose folder has gone is dropped from it rather than
 * shown as if it were still there.
 */

/** The one deliberate interaction the explorer performs. */
export interface SignIn {
  /** Playwright expressions, taken from the explored login page. */
  username: string;
  password: string;
  submit: string;
  /** The test account. Not a secret, and useful to see in the record. */
  user: string;
}

export interface Context {
  version: number;
  id: string;
  name: string;
  appUrl: string;
  createdAt: string;
  glossary: string[];
  signIn: SignIn | null;
  /** Who answers the small judgement calls: rules, model or jev. */
  judgeMode: string;
}

export interface ProjectRef {
  id: string;
  name: string;
  path: string;
}

export interface FolderCount {
  folder: string;
  files: number;
}

export interface OpenProject {
  id: string;
  name: string;
  appUrl: string;
  path: string;
  contextPath: string;
  createdAt: string;
  counts: FolderCount[];
  recovered: string | null;
}

function contextFile(projectPath: string): string {
  return join(contextDir(projectPath), "context.yaml");
}

export function readContext(projectPath: string): Context {
  const file = contextFile(projectPath);
  if (!existsSync(file)) throw new Error(`no project found in ${projectPath}`);
  const context = parse(readFileSync(file, "utf8")) as Partial<Context>;
  return {
    version: 1,
    glossary: [],
    signIn: null,
    judgeMode: "rules",
    appUrl: "",
    ...context,
  } as Context;
}

export function writeContext(projectPath: string, context: Context): void {
  atomicWrite(contextFile(projectPath), stringify(context, { lineWidth: 0 }));
}

export function listProjects(): ProjectRef[] {
  const all = readJson<ProjectRef[]>(registryPath(), []);
  // A project whose folder has been moved or deleted is not shown as if
  // it were still there.
  return all.filter((project) => existsSync(contextDir(project.path)));
}

function saveRegistry(projects: ProjectRef[]): void {
  writeJson(registryPath(), projects);
}

export function createProject(name: string, appUrl: string, chosen?: string): OpenProject {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("give the project a name");

  const id = slugify(trimmed);
  const path = chosen?.trim() ? chosen.trim() : join(projectsRoot(), id);

  for (const name of FOLDERS) mkdirSync(folder(path, name), { recursive: true });
  mkdirSync(folder(path, "decisions"), { recursive: true });

  writeContext(path, {
    version: 1,
    id,
    name: trimmed,
    appUrl: appUrl.trim(),
    createdAt: now(),
    glossary: [],
    signIn: null,
    judgeMode: "rules",
  });

  const projects = listProjects().filter((project) => project.id !== id);
  projects.push({ id, name: trimmed, path });
  saveRegistry(projects);

  return openProject(path);
}

export function openProject(projectPath: string): OpenProject {
  const context = readContext(projectPath);
  return {
    id: context.id,
    name: context.name,
    appUrl: context.appUrl,
    path: projectPath,
    contextPath: contextDir(projectPath),
    createdAt: context.createdAt,
    counts: FOLDERS.map((name) => ({
      folder: name,
      files: new Records<{ id: string }>(name).count(projectPath),
    })),
    recovered: null,
  };
}

/**
 * Changes a project's name or the application it tests.
 *
 * When the project lives in the app's own area the folder is renamed too,
 * so the path on disk does not keep saying something that is no longer
 * true. A project inside a folder the person chose — their test
 * repository, typically — keeps its folder, because moving that would
 * break a checkout.
 */
export function editProject(projectPath: string, name: string, appUrl: string): OpenProject {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("give the project a name");

  const context = readContext(projectPath);
  const id = slugify(trimmed);
  const managed = projectPath.startsWith(projectsRoot());

  let path = projectPath;
  if (managed && id !== context.id) {
    path = join(projectsRoot(), id);
    if (existsSync(path)) throw new Error(`there is already a project folder called ${id}`);
    renameSync(projectPath, path);
  }

  writeContext(path, { ...context, id, name: trimmed, appUrl: appUrl.trim() });

  const projects = listProjects().filter(
    (project) => project.path !== projectPath && project.path !== path,
  );
  projects.push({ id, name: trimmed, path });
  saveRegistry(projects);

  return openProject(path);
}

export function setJudgeMode(projectPath: string, mode: string): void {
  if (!["rules", "model", "jev"].includes(mode)) {
    throw new Error(`there is no judgement mode called ${mode}`);
  }
  writeContext(projectPath, { ...readContext(projectPath), judgeMode: mode });
}

export function setSignIn(projectPath: string, signIn: SignIn | null): void {
  writeContext(projectPath, { ...readContext(projectPath), signIn });
}

export interface Removed {
  trashed: string | null;
  note: string;
}

/**
 * Moves a path to the Trash rather than deleting it.
 *
 * Only where there is a Trash to move it to. Everywhere else this fails
 * and says so, which leaves the files where they are — better than
 * quietly turning "remove" into something unrecoverable.
 */
function toTrash(target: string): string {
  if (!existsSync(target)) throw new Error("there is nothing there to move");
  if (platform() !== "darwin") {
    throw new Error("this only moves files to the Trash on macOS — remove the folder yourself");
  }

  const trash = join(homedir(), ".Trash");
  if (!existsSync(trash)) throw new Error("no Trash folder on this machine");

  const name = target.split("/").filter(Boolean).pop() ?? "project";
  let destination = join(trash, name);
  for (let attempt = 1; existsSync(destination); attempt += 1) {
    if (attempt > 100) throw new Error("too many of these in the Trash already");
    destination = join(trash, `${name} ${attempt}`);
  }

  renameSync(target, destination);
  return destination;
}

/**
 * Takes a project off the list, and optionally puts its files in the
 * Trash.
 *
 * Two rules keep this from being the destructive thing it looks like.
 * Files always go to the Trash, never straight out — a project is weeks
 * of someone's review decisions. And a project living in a folder the
 * person chose only ever loses its own `.testinference` folder; deleting
 * the repository around it is not ours to do.
 */
export function removeProject(projectPath: string, deleteFiles: boolean): Removed {
  const projects = listProjects();
  saveRegistry(projects.filter((project) => project.path !== projectPath));

  if (!deleteFiles) {
    return {
      trashed: null,
      note: "Taken off the list. Nothing on disk was touched, so adding the folder again brings it all back.",
    };
  }

  const managed = projectPath.startsWith(projectsRoot());
  const target = managed ? projectPath : contextDir(projectPath);

  try {
    const moved = toTrash(target);
    return {
      trashed: moved,
      note: managed
        ? "The project folder is in the Trash. It is recoverable until you empty it."
        : "Its .testinference folder is in the Trash. The folder you chose, and anything else in it, is untouched.",
    };
  } catch (error) {
    return {
      trashed: null,
      note: `Taken off the list, but the files are still there: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Only for tests, which must be able to clean up after themselves. */
export function forget(projectPath: string): void {
  rmSync(projectPath, { recursive: true, force: true });
}
