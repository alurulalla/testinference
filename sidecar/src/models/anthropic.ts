import type { Adapter, Completion, CompletionRequest, Credentials, ModelSummary } from "./types.js";
import { COMPLETION_TIMEOUT_MS, TIMEOUT_MS } from "./types.js";

const BASE = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";

function headers(key: string): Record<string, string> {
  return { "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" };
}

export const anthropic: Adapter = {
  async listModels({ key }: Credentials): Promise<ModelSummary[]> {
    if (!key) throw new Error("no Anthropic key saved");

    const response = await fetch(`${BASE}/models?limit=100`, {
      headers: headers(key),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Anthropic answered ${response.status}`);

    const body = (await response.json()) as { data?: Array<{ id: string; display_name?: string }> };
    return (body.data ?? []).map((model) => ({
      id: model.id,
      label: model.display_name ?? model.id,
      contextWindow: null, // the listing does not say, so we do not guess
    }));
  },

  async complete({ key }: Credentials, request: CompletionRequest): Promise<Completion> {
    if (!key) throw new Error("no Anthropic key saved");

    const system = request.messages.filter((message) => message.role === "system");
    const user = request.messages.filter((message) => message.role !== "system");

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: user.map((message) => ({ role: "user", content: message.content })),
    };
    if (system.length > 0) body["system"] = system.map((message) => message.content).join("\n\n");

    // A tool with a schema is how this provider is asked for a shaped answer.
    if (request.schema) {
      body["tools"] = [{ name: "answer", description: "Return the answer.", input_schema: request.schema }];
      body["tool_choice"] = { type: "tool", name: "answer" };
    }

    const response = await fetch(`${BASE}/messages`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Anthropic answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const answer = (await response.json()) as {
      content?: Array<{ type: string; text?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const tool = answer.content?.find((part) => part.type === "tool_use");
    const text = answer.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "";

    return {
      text,
      data: tool?.input ?? null,
      inputTokens: answer.usage?.input_tokens ?? 0,
      outputTokens: answer.usage?.output_tokens ?? 0,
    };
  },
};
