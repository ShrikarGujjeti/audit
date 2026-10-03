import { createClient } from "@/lib/supabase/client";
import type { SessionState } from "./types";

/**
 * UX-only check of whether the browser still has a usable Supabase session
 * (never an authorization decision — the server/RLS remain authoritative).
 * A Server Action cannot be used for this: with an ended session the proxy
 * redirects the action request to /login, so the action throws instead of
 * reporting "unauthenticated".
 */
export async function probeBrowserSession(): Promise<SessionState> {
  try {
    const { data, error } = await createClient().auth.getUser();
    if (data?.user) return "authenticated";
    const e = error as { name?: string; status?: number } | null;
    if (e && (e.name === "AuthSessionMissingError" || e.status === 401 || e.status === 403)) {
      return "unauthenticated";
    }
    return "unknown"; // network trouble etc.: don't claim the session ended
  } catch {
    return "unknown";
  }
}
