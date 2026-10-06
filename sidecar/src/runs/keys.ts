/**
 * The API key for a provider.
 *
 * The keychain is the one thing still on the Rust side, because it is
 * the one thing the operating system does better than a file. The shell
 * hands the keys over when it starts the worker, and they stay in memory
 * here — never written anywhere, never logged.
 */
const keys = new Map<string, string>();

export function remember(provider: string, key: string | null): void {
  if (key) keys.set(provider, key);
  else keys.delete(provider);
}

export function keyFor(provider: string): string | null {
  return keys.get(provider) ?? null;
}

export function has(provider: string): boolean {
  return keys.has(provider);
}

/** "anthropic:claude-sonnet-4-6" → "anthropic" */
export function providerOf(model: string): string {
  return model.split(":")[0] ?? "";
}
