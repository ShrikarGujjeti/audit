/**
 * DEPENDENCY ON CLAUDE 1 — OD3(a) of TRIP_CHALO_PHASE6_EXPERIENCE_SPEC_v2.md.
 *
 * This file does NOT implement the signed-URL server entry point. Claude 1
 * owns `getMediaDownloadUrl` (src/modules/media/queries.ts) and the
 * server-side signed-URL implementation; this is the exact contract my
 * Timeline/Gallery/Viewer code needs on top of it. Nothing in this repo
 * yet implements the endpoint below — calling the client in url-client.ts
 * will fail until Claude 1 adds it.
 *
 * Required endpoint (Route Handler preferred per the spec, for batching and
 * future native reuse — a Server Action is acceptable for the single-item
 * viewer case):
 *
 *   POST /api/media/signed-urls
 *   body:  { mediaIds: string[] }   // bounded by the caller's window size
 *   auth:  the existing session cookie (createClient() / getClaims())
 *
 *   For each id:
 *     - validate with isMediaId() — reject malformed ids as "unavailable",
 *       not a thrown Postgres error (getMediaDownloadUrl today does NOT
 *       call isMediaId; this was flagged in the v1 audit as Claude 1's to
 *       fix, not duplicated here).
 *     - re-run the existing RLS-checked lookup (same logic as
 *       getMediaDownloadUrl) and presign a GET URL.
 *     - never return storage_key or any R2 credential.
 *
 *   response: SignedUrlResult[], one entry per requested id, same order
 *   not required — the client matches by `id`.
 */
export type SignedUrlResult =
  | { id: string; status: "ok"; url: string; ttlSeconds: number }
  | { id: string; status: "unavailable" };

export type SignedUrlFetcher = (mediaIds: string[]) => Promise<SignedUrlResult[]>;

/**
 * Default fetcher calling the not-yet-implemented endpoint above. Kept as
 * a separate, swappable value (rather than hardcoded inside the cache
 * below) so Claude 1's eventual implementation is a one-line change here,
 * and so a test can inject a fake fetcher without touching the cache logic.
 */
export const fetchSignedUrls: SignedUrlFetcher = async (mediaIds) => {
  const res = await fetch("/api/media/signed-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaIds }),
  });
  if (!res.ok) {
    return mediaIds.map((id) => ({ id, status: "unavailable" as const }));
  }
  return (await res.json()) as SignedUrlResult[];
};
