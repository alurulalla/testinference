import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

import { atomicWrite, folder } from "./paths.js";

/**
 * The step library: every Gherkin step the suite already has.
 *
 * Its whole purpose is to stop a suite growing fifteen ways of saying
 * "click Login".
 *
 * The file is `library.yaml`, a plain list, and the order is the order
 * steps were added. Both of those match what is already on disk — a port
 * that quietly changed the filename or the shape would read an existing
 * library as empty and start the collection again from nothing.
 */
function file(projectPath: string): string {
  return join(folder(projectPath, "steps"), "library.yaml");
}

export function read(projectPath: string): string[] {
  const path = file(projectPath);
  if (!existsSync(path)) return [];
  try {
    const list = parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(list) ? list.filter((step): step is string => typeof step === "string") : [];
  } catch {
    return [];
  }
}

export function write(projectPath: string, steps: string[]): void {
  atomicWrite(file(projectPath), stringify(steps, { lineWidth: 0 }));
}
