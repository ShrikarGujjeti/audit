import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  createPresignedDownloadUrl,
  PRESIGNED_GET_TTL_SECONDS,
} from "@/modules/storage/r2";
import { isTripId } from "@/modules/trips/validation";
import { isMediaId, MAX_URLS_PER_REQUEST } from "./validation";

export type MediaUrlResult =
  | { id: string; url: string; ttlSeconds: number }
  | { id: string; unavailable: true };

/**
 * Issues short-lived signed GET URLs for ready media in ONE trip.
 *
 * Authorization is the user-scoped Supabase client: a single RLS-checked
 * lookup (media_select_member, 0015) scoped to trip_id, so an id from another
 * trip, a pending/failed row, a malformed id, a nonexistent id and an
 * inaccessible id are all the same uniform { unavailable: true }.
 * storage_key never leaves this function.
 *
 * NOTE (policy, see report): RLS admits a DEPARTED uploader to their own rows
 * (0015). That is spec-intended for delete; this endpoint therefore also lets
 * them fetch URLs for their own historical uploads. Flagged as an open
 * product question, not silently decided.
 */
export async function issueMediaUrls(
  tripId: string,
  mediaIds: string[]
): Promise<MediaUrlResult[]> {
  const ordered = [...new Set(mediaIds)].slice(0, MAX_URLS_PER_REQUEST);
  const valid = isTripId(tripId) ? ordered.filter(isMediaId) : [];

  const urlsById = new Map<string, string>();

  if (valid.length > 0) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("media")
      .select("id, storage_key")
      .eq("trip_id", tripId)
      .eq("processing_status", "ready")
      .in("id", valid);

    if (error) {
      console.error("[media] issueMediaUrls lookup failed", {
        code: error.code, message: error.message, details: error.details, hint: error.hint,
      });
      throw new Error("Failed to load media");
    }

    // Signing is local CPU work (no network), so this is cheap.
    await Promise.all(
      (data ?? []).map(async (row) => {
        try {
          urlsById.set(row.id, await createPresignedDownloadUrl(row.storage_key));
        } catch (err) {
          console.error("[media] presign failed", { mediaId: row.id, err });
        }
      })
    );
  }

  return ordered.map((id) => {
    const url = urlsById.get(id);
    return url
      ? { id, url, ttlSeconds: PRESIGNED_GET_TTL_SECONDS }
      : { id, unavailable: true as const };
  });
}
