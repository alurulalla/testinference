import type { Adapter, Completion, CompletionRequest, Credentials, ModelSummary } from "./types.js";
import { COMPLETION_TIMEOUT_MS, TIMEOUT_MS } from "./types.js";

/**
 * Everything OpenAI-shaped: OpenAI itself, Azure, Groq, Together,
 * OpenRouter — and every local runner, which is the same shape pointed at
 * your own machine.
 */
const DEFAULT_ENDPOINT = "https://api.openai.com/v1";

function base({ endpoint }: Credentials): string {
  return (endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
}

function headers({ key }: Credentials): Record<string, string> {
  const result: Record<string, string> = { "content-type": "application/json" };
  if (key) result["authorization"] = `Bearer ${key}`;
  return result;
}

export const openaiShaped: Adapter = {
  async listModels(credentials: Credentials): Promise<ModelSummary[]> {
    const response = await fetch(`${base(credentials)}/models`, {
      headers: headers(credentials),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`the endpoint answered ${response.status}`);

    const body = (await response.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((model) => ({ id: model.id, label: model.id, contextWindow: null }));
  },

  async complete(credentials: Credentials, request: CompletionRequest): Promise<Completion> {
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
    };

    if (request.schema) {
      body["response_format"] = {
        type: "json_schema",
        json_schema: { name: "answer", schema: request.schema, strict: false },
      };
    }

    const response = await fetch(`${base(credentials)}/chat/completions`, {
      method: "POST",
      headers: headers(credentials),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`the endpoint answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const answer = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = answer.choices?.[0]?.message?.content ?? "";

    return {
      text,
      data: request.schema ? safeParse(text) : null,
      inputTokens: answer.usage?.prompt_tokens ?? 0,
      outputTokens: answer.usage?.completion_tokens ?? 0,
    };
  },
};

function safeParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
