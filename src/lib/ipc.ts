import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CommandName, Commands, EventName, Events } from "../types/api";

/**
 * The few things the shell answers itself. Everything else is the
 * worker's, and goes through the relay.
 *
 * The keychain is the shell's because it is the one thing the operating
 * system does better than a file. A key is stored there and handed to the
 * worker, and never comes back to the window — the window only ever
 * learns whether one is present.
 */
const SHELL: Record<string, (args: Record<string, unknown>) => [string, Record<string, unknown>]> = {
  core_info: () => ["core_info", {}],
  worker_status: () => ["worker_status", {}],
  provider_set_key: (args) => ["secret_set", { name: args["provider"], value: args["key"] }],
  provider_clear_key: (args) => ["secret_clear", { name: args["provider"] }],
  sign_in_secret_set: (args) => [
    "secret_set",
    { name: `signin:${String(args["projectId"])}`, value: args["secret"] },
  ],
  sign_in_secret_clear: (args) => ["secret_clear", { name: `signin:${String(args["projectId"])}` }],
};

/**
 * Typed wrapper around the core. Call sites get argument and return types
 * from Commands, so a renamed command fails at compile time rather than
 * silently at runtime.
 */
export async function call<K extends CommandName>(
  command: K,
  args: Commands[K]["args"],
): Promise<Commands[K]["result"]> {
  const own = SHELL[command];
  if (own) {
    const [name, mapped] = own(args as Record<string, unknown>);
    return invoke<Commands[K]["result"]>(name, mapped);
  }
  return invoke<Commands[K]["result"]>("relay", { method: command, params: args });
}

/** Subscribes to a core event. Returns the unsubscribe function. */
export async function on<K extends EventName>(
  event: K,
  handler: (payload: Events[K]) => void,
): Promise<UnlistenFn> {
  return listen<Events[K]>(event, (message) => handler(message.payload));
}

/** True when the renderer is running inside the Tauri shell rather than a bare browser tab. */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
