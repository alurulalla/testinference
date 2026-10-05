import type { Adapter, Completion, CompletionRequest, Credentials, ModelSummary } from "./types.js";
import { COMPLETION_TIMEOUT_MS, TIMEOUT_MS } from "./types.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export const gemini: Adapter = {
  async listModels({ key }: Credentials): Promise<ModelSummary[]> {
    if (!key) throw new Error("no Google key saved");

    const response = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=200`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Google answered ${response.status}`);

    const body = (await response.json()) as {
      models?: Array<{ name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }>;
    };

    return (body.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent") ?? true)
      .map((model) => ({
        id: model.name.replace(/^models\//, ""),
        label: model.displayName ?? model.name,
        contextWindow: model.inputTokenLimit ?? null,
      }));
  },

  async complete({ key }: Credentials, request: CompletionRequest): Promise<Completion> {
    if (!key) throw new Error("no Google key saved");

    const system = request.messages.filter((message) => message.role === "system");
    const user = request.messages.filter((message) => message.role !== "system");

    const body: Record<string, unknown> = {
      contents: user.map((message) => ({ role: "user", parts: [{ text: message.content }] })),
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 1024,
        ...(request.schema
          ? { responseMimeType: "application/json", responseSchema: request.schema }
          : {}),
      },
    };
    if (system.length > 0) {
      body["systemInstruction"] = { parts: system.map((message) => ({ text: message.content })) };
    }

    const url = `${BASE}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Google answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const answer = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = answer.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";

    let data: unknown | null = null;
    if (request.schema) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    return {
      text,
      data,
      inputTokens: answer.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: answer.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },
};
