import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/modules/auth/session";
import { issueMediaUrls } from "@/modules/media/urls";
import { MAX_URLS_PER_REQUEST } from "@/modules/media/validation";

/**
 * POST /api/trips/:tripId/media-urls
 * Body:     { "ids": string[] }            (1..MAX_URLS_PER_REQUEST media ids)
 * 200:      { "results": Array<{id,url,ttlSeconds} | {id,unavailable:true}> }
 * 400/401/403/413/415/500: { "error": string }
 *
 * Auth is cookie-session (same as the rest of the app). The proxy does not
 * guard /api, so this handler authenticates itself and answers JSON 401
 * instead of redirecting. Never cached. No storage keys or credentials in the
 * response. A Route Handler (not a Server Action) so the browser can issue
 * concurrent window batches (Server Actions are serialized) and a native
 * client can reuse the contract later (spec OD3a / Appendix G.4).
 */
const HEADERS = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 16 * 1024;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> }
) {
  // CSRF hardening beyond SameSite cookies: a JSON content type forces a CORS
  // preflight cross-origin, and we also refuse browser-declared cross-site calls.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return fail(403, "Forbidden");
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return fail(415, "Expected application/json");
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return fail(413, "Request too large");
  }

  const userId = await getCurrentUserId();
  if (!userId) return fail(401, "Not signed in");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Invalid JSON");
  }

  const ids = (body as { ids?: unknown } | null)?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_URLS_PER_REQUEST ||
    !ids.every((v) => typeof v === "string")
  ) {
    return fail(400, `ids must be 1-${MAX_URLS_PER_REQUEST} strings`);
  }

  const { tripId } = await context.params;

  try {
    const results = await issueMediaUrls(tripId, ids as string[]);
    return NextResponse.json({ results }, { headers: HEADERS });
  } catch {
    // Details are already logged server-side.
    return fail(500, "Could not prepare media");
  }
}
