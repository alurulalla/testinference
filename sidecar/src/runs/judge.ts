import { keyFor } from "./keys.js";
import { readContext } from "../store/project.js";
import { load as loadSettings } from "../store/settings.js";

/**
 * What a call needs to route its judgement: the mode in force and, when
 * it is Jev, the credentials to reach it.
 *
 * A mode that is chosen but not set up comes back as rules, so a caller
 * never has to ask whether the key is there — the fallback is already
 * the answer.
 */
export const JEV_MODEL = "jev-latest";

export function judgeSettings(projectPath: string): Record<string, unknown> {
  const settings = loadSettings();

  let mode = "rules";
  try {
    mode = readContext(projectPath).judgeMode;
  } catch {
    /* a project that cannot be read judges by rules */
  }

  const key = mode === "jev" ? keyFor("jev") : mode === "model" ? null : null;
  if (mode === "jev" && !key) mode = "rules";
  if (mode === "model" && !settings.assignments["judge"]) mode = "rules";

  return {
    mode,
    key,
    endpoint: settings.jevEndpoint,
    model: mode === "jev" ? (settings.jevModel ?? JEV_MODEL) : (settings.assignments["judge"] ?? null),
    atOnce: settings.budgets.maxParallel,
  };
}
