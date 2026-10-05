import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * The detail column belongs to the shell, not to a panel — it runs the full
 * height of the window down the right edge. A panel publishes what should be
 * in it and the shell renders it.
 *
 * A panel also publishes how to close it. The shell draws the close button
 * and listens for Escape, but only the panel knows what "closed" means —
 * usually that nothing is selected any more, so the row it came from stops
 * looking selected too.
 */
export interface Detail {
  node: ReactNode | null;
  close: (() => void) | null;
}

const DetailContext = createContext<(detail: Detail) => void>(() => {});

export const DetailProvider = DetailContext.Provider;

export function useDetail(node: ReactNode | null, deps: unknown[], close?: () => void) {
  const set = useContext(DetailContext);
  useEffect(() => {
    set({ node, close: node === null ? null : (close ?? null) });
    return () => set({ node: null, close: null });
    // The panel decides when its detail changed; the node itself is new on
    // every render and would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
