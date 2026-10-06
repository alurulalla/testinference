/**
 * Stopping a run that is already going.
 *
 * A flag rather than an abort signal, because a run is a loop over
 * batches and the useful place to stop is between them: a half-finished
 * batch produces nothing, and killing one mid-flight would waste what it
 * had already been paid for.
 */
const stopping = new Set<string>();

export function askToStop(kind: string): void {
  stopping.add(kind);
}

export function clear(kind: string): void {
  stopping.delete(kind);
}

export function stopRequested(kind: string): boolean {
  return stopping.has(kind);
}
