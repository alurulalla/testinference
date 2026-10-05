import { anthropic } from "./anthropic.js";
import { gemini } from "./gemini.js";
import { openaiShaped } from "./openai.js";
import {
  describe,
  splitModelId,
  type Adapter,
  type Capabilities,
  type Completion,
  type CompletionRequest,
  type Credentials,
  type ModelSummary,
  type ProviderKind,
  type SelfTest,
} from "./types.js";

export * from "./types.js";

const ADAPTERS: Record<ProviderKind, Adapter> = {
  anthropic,
  openai: openaiShaped,
  gemini,
  // A local runner speaks the same shape; only the address differs.
  local: openaiShaped,
  // Jev is deliberately absent. It answers typed questions about a state
  // rather than completing prose, so it cannot do any of the writing jobs;
  // it lives in decisions/jev.ts, where the judging happens.
};

export function adapterFor(provider: ProviderKind): Adapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`no adapter for ${provider}`);
  return adapter;
}

export async function listModels(params: Record<string, unknown>): Promise<ModelSummary[]> {
  const provider = params["provider"] as ProviderKind;
  const credentials = credentialsFrom(params);
  return adapterFor(provider).listModels(credentials);
}

export async function complete(params: Record<string, unknown>): Promise<Completion> {
  const id = String(params["model"] ?? "");
  const { provider, model } = splitModelId(id);
  const request = params["request"] as Omit<CompletionRequest, "model">;
  return adapterFor(provider).complete(credentialsFrom(params), { ...request, model });
}

/**
 * The smallest real request that tells us whether a model can do the job.
 *
 * It asks for a shaped answer and checks the shape came back, because the
 * whole pipeline depends on that and a model that cannot do it will fail in
 * a way that looks like bad writing rather than a missing feature.
 */
const PROBE_SCHEMA = {
  type: "object",
  properties: {
    days: { type: "integer", description: "the number of days in a week" },
    colour: { type: "string", description: "the colour of a clear sky" },
  },
  required: ["days", "colour"],
} as const;

export async function selfTest(params: Record<string, unknown>): Promise<SelfTest> {
  const id = String(params["model"] ?? "");
  const credentials = credentialsFrom(params);
  const contextWindow = typeof params["contextWindow"] === "number" ? params["contextWindow"] : null;

  let provider: ProviderKind;
  let model: string;
  try {
    ({ provider, model } = splitModelId(id));
  } catch (error: unknown) {
    return { ok: false, capabilities: null, detail: describe(error) };
  }

  const started = Date.now();
  try {
    const answer = await adapterFor(provider).complete(credentials, {
      model,
      maxTokens: 256,
      schema: PROBE_SCHEMA as unknown as Record<string, unknown>,
      messages: [
        { role: "system", content: "Answer with the requested fields and nothing else." },
        { role: "user", content: "How many days are in a week, and what colour is a clear sky?" },
      ],
    });

    const latencyMs = Date.now() - started;
    const structured = readsBack(answer);

    return {
      ok: true,
      capabilities: {
        structured,
        latencyMs,
        contextWindow,
        note: structured
          ? "answers in the shape it is asked for"
          : "replied, but not in the shape it was asked for — fine for summaries, risky for the pipeline",
      } satisfies Capabilities,
      detail: structured ? "ready to use" : "usable only where the answer shape does not matter",
    };
  } catch (error: unknown) {
    return { ok: false, capabilities: null, detail: describe(error) };
  }
}

/** True when the answer came back as data with the fields we asked for. */
function readsBack(answer: Completion): boolean {
  const data = answer.data as { days?: unknown; colour?: unknown } | null;
  if (!data || typeof data !== "object") return false;
  return typeof data.days === "number" && typeof data.colour === "string";
}

function credentialsFrom(params: Record<string, unknown>): Credentials {
  return {
    key: typeof params["key"] === "string" ? params["key"] : null,
    endpoint: typeof params["endpoint"] === "string" ? params["endpoint"] : null,
  };
}
