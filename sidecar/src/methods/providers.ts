import { log } from "../protocol.js";
import { models as jevModels } from "../decisions/jev.js";

const TIMEOUT_MS = 8000;

export interface Validation {
  state: "valid" | "invalid" | "unreachable" | "unsupported" | "missing";
  detail?: string;
}

/**
 * Checks a provider key by making the cheapest real call that proves it works.
 * The key arrives from the keychain for this call only; it is never logged,
 * never cached here, and never written anywhere.
 */
export async function validate(params: Record<string, unknown>): Promise<Validation> {
  const provider = typeof params["provider"] === "string" ? params["provider"] : "";
  const key = typeof params["key"] === "string" ? params["key"] : null;
  const endpoint = typeof params["endpoint"] === "string" ? params["endpoint"] : null;

  switch (provider) {
    case "anthropic":
      return validateAnthropic(key);
    case "local":
      return validateLocal(endpoint);
    case "jev":
      return validateJev(key, endpoint);
    default:
      return { state: "unsupported", detail: `unknown provider ${provider}` };
  }
}

async function validateAnthropic(key: string | null): Promise<Validation> {
  if (!key) return { state: "missing", detail: "no key saved yet" };

  try {
    // Listing models costs nothing and still proves the key is accepted.
    const response = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.ok) return { state: "valid", detail: "the key was accepted" };
    if (response.status === 401 || response.status === 403) {
      return { state: "invalid", detail: `the key was rejected (${response.status})` };
    }
    return { state: "unreachable", detail: `Anthropic answered ${response.status}` };
  } catch (error: unknown) {
    log(`anthropic validation failed: ${describe(error)}`);
    return { state: "unreachable", detail: describe(error) };
  }
}

async function validateJev(key: string | null, endpoint: string | null): Promise<Validation> {
  if (!key) return { state: "missing", detail: "no key saved yet" };

  try {
    // Listing the models costs nothing and still proves the key is accepted.
    const names = await jevModels({ key, endpoint });
    return {
      state: "valid",
      detail: names.length > 0 ? `the key was accepted · ${names.join(", ")}` : "the key was accepted",
    };
  } catch (error: unknown) {
    const detail = describe(error);
    if (detail.includes("401")) return { state: "invalid", detail: "the key was rejected (401)" };
    log(`jev validation failed: ${detail}`);
    return { state: "unreachable", detail };
  }
}

async function validateLocal(endpoint: string | null): Promise<Validation> {
  if (!endpoint) return { state: "missing", detail: "no endpoint set" };

  try {
    const url = `${endpoint.replace(/\/$/, "")}/models`;
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.ok) return { state: "valid", detail: "the endpoint answered" };
    return { state: "unreachable", detail: `the endpoint answered ${response.status}` };
  } catch (error: unknown) {
    return { state: "unreachable", detail: describe(error) };
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
