import { configPath, readJson, writeJson } from "./app.js";

/**
 * Settings that belong to the machine: which model does which job, what
 * things cost, and what the spend limits are.
 *
 * Nothing secret lives here. Keys are in the operating system's keychain,
 * which is the one thing the Rust shell still does.
 */

/** The jobs a model can be assigned to. They are not equally hard. */
export const JOBS: Array<[string, string]> = [
  ["read-documents", "Reading documents"],
  ["design-scenarios", "Designing scenarios"],
  ["complete-tcer", "Completing TCER rows"],
  ["write-cases", "Writing test cases"],
  ["write-bdd", "Writing BDD"],
  ["judge", "Judging and labelling"],
  ["summarise", "Summaries"],
];

export interface Budgets {
  /** A single run stops here rather than quietly spending more. */
  perRun: number;
  monthly: number;
  /** How many model calls may be in flight at once. */
  maxParallel: number;
}

/**
 * What a model costs, per million tokens.
 *
 * Nothing is hardcoded: published prices change, and a wrong number in a
 * budget is worse than no number.
 */
export interface Price {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface Settings {
  prices: Record<string, Price>;
  localEndpoint: string | null;
  openaiEndpoint: string | null;
  /** Where Jev answers. Unset is how the app knows it is not available. */
  jevEndpoint: string | null;
  jevModel: string | null;
  /** Job name to "provider:model". */
  assignments: Record<string, string>;
  budgets: Budgets;
  /** What the last self-test found, per model. */
  capabilities: Record<string, unknown>;
  /** Local models only; no falling back to a cloud provider. */
  privateMode: boolean;
  /** So the app opens where you left it. */
  lastProject: string | null;
}

const EMPTY: Settings = {
  prices: {},
  localEndpoint: null,
  openaiEndpoint: null,
  jevEndpoint: null,
  jevModel: null,
  assignments: {},
  budgets: { perRun: 10, monthly: 150, maxParallel: 4 },
  capabilities: {},
  privateMode: false,
  lastProject: null,
};

export function load(): Settings {
  return { ...EMPTY, ...readJson<Partial<Settings>>(configPath(), {}) };
}

export function save(settings: Settings): void {
  writeJson(configPath(), settings);
}

/** Changes one thing and writes the rest back as it was. */
export function update(change: Partial<Settings>): Settings {
  const settings = { ...load(), ...change };
  save(settings);
  return settings;
}

/** The endpoint a provider answers on, when it is not the usual one. */
export function endpointFor(provider: string, settings = load()): string | null {
  if (provider === "local") return settings.localEndpoint;
  if (provider === "openai") return settings.openaiEndpoint;
  if (provider === "jev") return settings.jevEndpoint;
  return null;
}

/**
 * What a run cost, when the price is known.
 *
 * Null rather than zero when it is not: a run of unknown cost is not a
 * free run, and the spend guard must not treat it as one.
 */
export function costOf(
  model: string,
  inputTokens: number,
  outputTokens: number,
  settings = load(),
): number | null {
  const price = settings.prices[model];
  if (!price) return null;
  return (
    (inputTokens / 1_000_000) * price.inputPerMillion +
    (outputTokens / 1_000_000) * price.outputPerMillion
  );
}
