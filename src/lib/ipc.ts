import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CommandName, Commands, EventName, Events } from "../types/api";

/**
 * Typed wrapper around Tauri's invoke. Call sites get argument and return
 * types from Commands, so a renamed command fails at compile time rather
 * than silently at runtime.
 */
export async function call<K extends CommandName>(
  command: K,
  args: Commands[K]["args"],
): Promise<Commands[K]["result"]> {
  return invoke<Commands[K]["result"]>(command, args);
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
