"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSignedUrls, type SignedUrlFetcher } from "./url-contract";

/** Spec section 11: reuse within lifetime minus a safety margin (~60s [H]). */
const SAFETY_MARGIN_MS = 60_000;

type Held = { url: string; expiresAtMs: number };

/**
 * In-memory (never localStorage/sessionStorage — spec section 11: "Issued
 * URLs are held in memory only") cache of signed URLs, keyed by media id.
 * Deliberately a React hook, not a module-level singleton: each mounted
 * gallery/viewer instance owns its own cache, which naturally releases
 * memory when the component unmounts (section 18 performance: off-window
 * tiles release their image).
 */
export function useSignedUrls(fetcher: SignedUrlFetcher = fetchSignedUrls) {
  const [, forceRender] = useState(0);
  const held = useRef(new Map<string, Held>());
  const inflight = useRef(new Set<string>());

  const isFresh = useCallback((id: string, now: number) => {
    const entry = held.current.get(id);
    return !!entry && entry.expiresAtMs - SAFETY_MARGIN_MS > now;
  }, []);

  const get = useCallback(
    (id: string): string | null => {
      const entry = held.current.get(id);
      return entry ?? null ? (isFresh(id, Date.now()) ? entry!.url : null) : null;
    },
    [isFresh]
  );

  /** Requests fresh URLs only for ids that are missing or near expiry —
   * never re-requests an id that's still safely valid (section 11/18). */
  const ensure = useCallback(
    async (ids: string[]) => {
      const now = Date.now();
      const need = ids.filter((id) => !isFresh(id, now) && !inflight.current.has(id));
      if (need.length === 0) return;
      need.forEach((id) => inflight.current.add(id));

      try {
        const results = await fetcher(need);
        for (const result of results) {
          if (result.status === "ok") {
            held.current.set(result.id, {
              url: result.url,
              expiresAtMs: Date.now() + result.ttlSeconds * 1000,
            });
          } else {
            held.current.delete(result.id);
          }
        }
      } finally {
        need.forEach((id) => inflight.current.delete(id));
        forceRender((n) => n + 1);
      }
    },
    [fetcher, isFresh]
  );

  /** Always-fresh URL for "Open original" (section 11: "always for Open
   * original") — bypasses the cache entirely rather than relying on
   * whatever happens to be held. */
  const fetchFresh = useCallback(
    async (id: string): Promise<string | null> => {
      const results = await fetcher([id]);
      const result = results.find((r) => r.id === id);
      if (!result || result.status !== "ok") return null;
      held.current.set(id, { url: result.url, expiresAtMs: Date.now() + result.ttlSeconds * 1000 });
      forceRender((n) => n + 1);
      return result.url;
    },
    [fetcher]
  );

  const invalidate = useCallback((id: string) => {
    held.current.delete(id);
  }, []);

  useEffect(() => {
    return () => {
      held.current.clear();
    };
  }, []);

  return { get, ensure, fetchFresh, invalidate };
}
