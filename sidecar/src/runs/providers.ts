import { listModels, selfTest } from "../models/index.js";
import { validate } from "../methods/providers.js";
import * as settings from "../store/settings.js";
import { has, keyFor, providerOf, remember } from "./keys.js";

/**
 * Which providers are set up, which model does which job, and what it
 * costs. Nothing secret passes through here that is not already in
 * memory: the keys arrive from the shell's keychain and are never
 * written anywhere.
 */

/** Providers the app knows about. Jev answers typed questions and is never offered for writing. */
export const PROVIDERS: Array<[string, string]> = [
  ["anthropic", "Anthropic"],
  ["openai", "OpenAI-compatible"],
  ["gemini", "Google Gemini"],
  ["local", "Local model"],
  ["jev", "Jev"],
];

export interface Validation {
  state: string;
  detail: string | null;
  checkedAtMs: number;
}

/**
 * Last validation outcome per provider. In memory only — a key that was
 * valid an hour ago is not evidence that it is valid now.
 */
const validations = new Map<string, Validation>();

/** Called when the shell hands over, or takes back, a key. */
export function keyChanged(name: string, value: string | null): void {
  remember(name, value);
  // A removed or replaced key has not been checked yet.
  validations.delete(name);
}

export function providerList() {
  const current = settings.load();
  return PROVIDERS.map(([id, label]) => ({
    id,
    label,
    hasKey: has(id),
    endpoint: id === "local" ? current.localEndpoint : id === "jev" ? current.jevEndpoint : null,
    validation: validations.get(id) ?? null,
  }));
}

export async function validateProvider(provider: string): Promise<Validation> {
  const current = settings.load();
  const key = keyFor(provider);

  const remembered = (state: string, detail: string | null): Validation => {
    const result = { state, detail, checkedAtMs: Date.now() };
    validations.set(provider, result);
    return result;
  };

  if (provider !== "local" && key === null) return remembered("missing", "no key saved yet");

  const answer = await validate({
    provider,
    key,
    endpoint: provider === "jev" ? current.jevEndpoint : current.localEndpoint,
  });
  return remembered(answer.state, answer.detail ?? null);
}

export function settingsGet() {
  const current = settings.load();
  return {
    jobs: settings.JOBS.map(([id, label]) => ({
      id,
      label,
      model: current.assignments[id] ?? null,
    })),
    budgets: current.budgets,
    capabilities: current.capabilities,
    prices: current.prices,
    localEndpoint: current.localEndpoint,
    openaiEndpoint: current.openaiEndpoint,
    jevEndpoint: current.jevEndpoint,
    jevModel: current.jevModel,
    privateMode: current.privateMode,
  };
}

export function setEndpoint(provider: string, endpoint: string): void {
  const value = endpoint.trim() === "" ? null : endpoint.trim();
  switch (provider) {
    case "local":
      settings.update({ localEndpoint: value });
      return;
    case "openai":
      settings.update({ openaiEndpoint: value });
      return;
    case "jev":
      settings.update({ jevEndpoint: value });
      return;
    default:
      throw new Error(`${provider} does not take an endpoint`);
  }
}

export function setJevModel(model: string): void {
  settings.update({ jevModel: model.trim() === "" ? null : model.trim() });
}

export function setAssignment(job: string, model: string): void {
  if (!settings.JOBS.some(([id]) => id === job)) throw new Error(`there is no job called ${job}`);

  const assignments = { ...settings.load().assignments };
  if (model.trim() === "") delete assignments[job];
  else assignments[job] = model;
  settings.update({ assignments });
}

export function setBudgets(perRun: number, monthly: number, maxParallel: number): void {
  if (perRun <= 0 || monthly <= 0 || maxParallel <= 0) {
    throw new Error("budgets have to be above zero");
  }
  settings.update({ budgets: { perRun, monthly, maxParallel } });
}

export function setPrice(model: string, inputPerMillion: number, outputPerMillion: number): void {
  const prices = { ...settings.load().prices };
  if (inputPerMillion <= 0 && outputPerMillion <= 0) delete prices[model];
  else prices[model] = { inputPerMillion, outputPerMillion };
  settings.update({ prices });
}

export function modelsList(provider: string) {
  const current = settings.load();
  return listModels({
    provider,
    key: keyFor(provider),
    endpoint: settings.endpointFor(provider, current),
  });
}

/** Asks a model to prove it can do the job, and remembers what it found. */
export async function modelSelfTest(model: string, contextWindow: number | null) {
  const provider = providerOf(model);
  const current = settings.load();
  const answer = await selfTest({
    model,
    key: keyFor(provider),
    endpoint: settings.endpointFor(provider, current),
    contextWindow,
  });
  settings.update({ capabilities: { ...current.capabilities, [model]: answer } });
  return answer;
}

