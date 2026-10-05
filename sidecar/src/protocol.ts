/**
 * The wire format between the Rust core and this worker.
 *
 * One JSON object per line. stdout carries protocol only — anything the
 * worker wants to say to a human goes to stderr, which the core forwards
 * to the UI as log lines.
 */

export interface Request {
  id: number;
  method: string;
  params?: unknown;
}

export type Reply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string } };

export interface Event {
  event: string;
  payload: unknown;
}

export type Handler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

export function send(message: Reply | Event): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export function emit(event: string, payload: unknown): void {
  send({ event, payload });
}

export function log(line: string): void {
  process.stderr.write(`${line}\n`);
}
