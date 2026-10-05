/**
 * One socket, three shapes of plug.
 *
 * Agents ask for "the model assigned to my job" and never name a vendor, so
 * adding a provider is a new file here and nothing else.
 */

export type ProviderKind = "anthropic" | "openai" | "gemini" | "local";

/** "anthropic:claude-sonnet-5" — provider and model in one string. */
export type ModelId = string;

export interface Credentials {
  key: string | null;
  /** For local models and anything OpenAI-shaped behind its own address. */
  endpoint: string | null;
}

export interface ModelSummary {
  id: string;
  label: string;
  /** Only some providers say; we record what we are told and nothing more. */
  contextWindow: number | null;
}

export interface Capabilities {
  /** Can it return an answer that fits a given shape? The pipeline needs this. */
  structured: boolean;
  /** Round trip for a trivial request, in milliseconds. */
  latencyMs: number;
  contextWindow: number | null;
  note: string;
}

export interface SelfTest {
  ok: boolean;
  capabilities: Capabilities | null;
  detail: string;
}

export interface Message {
  role: "system" | "user";
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: Message[];
  /** When given, the answer must fit this shape or the call fails. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface Completion {
  text: string;
  data: unknown | null;
  inputTokens: number;
  outputTokens: number;
}

export interface Adapter {
  listModels(credentials: Credentials): Promise<ModelSummary[]>;
  complete(credentials: Credentials, request: CompletionRequest): Promise<Completion>;
}

/** Listing models or probing a key — a quick call. */
export const TIMEOUT_MS = 30_000;
/** Writing an answer of a few thousand tokens is not a quick call. */
export const COMPLETION_TIMEOUT_MS = 180_000;

export function splitModelId(id: ModelId): { provider: ProviderKind; model: string } {
  const at = id.indexOf(":");
  if (at === -1) throw new Error(`"${id}" should look like provider:model`);
  return { provider: id.slice(0, at) as ProviderKind, model: id.slice(at + 1) };
}

export function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
