"use client";

import { createContext, useCallback, useContext, useRef } from "react";
import { useRouter } from "next/navigation";

const REFRESH_DEBOUNCE_MS = 1500; // [H], spec section 13: "about 1-2s"

type RefreshFn = () => void;
const MediaRefreshContext = createContext<RefreshFn | null>(null);

/**
 * INTEGRATION POINT FOR CLAUDE 3: after a successful confirmMediaUploadAction
 * (or a batch of them), call this hook's returned function. It debounces
 * and calls router.refresh(), which re-runs the server-component data fetch
 * (listTripMedia et al.) WITHOUT a full page reload and WITHOUT resetting
 * scroll position (Next.js App Router preserves scroll across refresh()).
 * This is the "client-triggered, coalesced refresh" OD3(b) asks for.
 *
 * Usage: const refresh = useMediaRefresh(); refresh(); // after each confirm
 */
export function useMediaRefresh(): RefreshFn {
  const fromContext = useContext(MediaRefreshContext);
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
  }, [router]);

  return fromContext ?? debounced;
}

export { MediaRefreshContext };
