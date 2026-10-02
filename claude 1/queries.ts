import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createPresignedDownloadUrl } from "@/modules/storage/r2";
import { isTripId } from "@/modules/trips/validation";
import { isMediaId } from "./validation";

export type MediaType = "photo" | "video";
export type MediaProcessingStatus = "pending" | "processing" | "ready" | "failed";

/**
 * Client-safe media DTO. storage_key is deliberately NOT part of it: nothing
 * in the UI needs it, and the only way to reach bytes is a signed URL issued
 * by media/urls.ts. (Breaking change vs. the previous type, which exposed it.)
 */
export type Media = {
  id: string;
  trip_id: string;
  uploader_id: string | null;
  media_type: MediaType;
  original_filename: string | null;
  mime_type: string;
  file_size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  captured_at: string | null;
  uploaded_at: string | null;
  processing_status: MediaProcessingStatus;
  created_at: string;
};

const MEDIA_COLUMNS =
  "id, trip_id, uploader_id, media_type, original_filename, mime_type, file_size_bytes, width, height, duration_seconds, captured_at, uploaded_at, processing_status, created_at";

/** Below any plausible PostgREST max_rows (local config: 1000). */
export const DEFAULT_MEDIA_PAGE_LIMIT = 500;

export type MediaPage = {
  items: Media[];
  /** Exact number of ready media rows visible to the caller for this trip. */
  totalCount: number;
  /** True when totalCount > items.length (items are the EARLIEST by chronology). */
  truncated: boolean;
};

/**
 * Ready media, ordered by chronology_at (0012) then id. Truncation is detected
 * from PostgREST's exact count -- not by comparing to a hardcoded cap -- so it
 * stays correct whatever max_rows the hosted project uses (spec 14).
 * RLS (media_select_member, 0015) decides visibility; pending/failed rows are
 * excluded.
 */
export async function listTripMediaPage(
  tripId: string,
  limit: number = DEFAULT_MEDIA_PAGE_LIMIT
): Promise<MediaPage> {
  if (!isTripId(tripId)) return { items: [], totalCount: 0, truncated: false };

  const safeLimit = Math.max(1, Math.min(Math.floor(limit), DEFAULT_MEDIA_PAGE_LIMIT));
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("media")
    .select(MEDIA_COLUMNS, { count: "exact" })
    .eq("trip_id", tripId)
    .eq("processing_status", "ready")
    .order("chronology_at", { ascending: true })
    .order("id", { ascending: true })
    .range(0, safeLimit - 1);

  if (error) {
    console.error("[media] listTripMediaPage failed", {
      code: error.code, message: error.message, details: error.details, hint: error.hint,
    });
    throw new Error("Failed to load media");
  }

  const items = data as Media[];
  const totalCount = count ?? items.length;
  return { items, totalCount, truncated: totalCount > items.length };
}

/**
 * Backwards-compatible wrapper (same name/shape as before, minus storage_key).
 * Callers that must show the "truncated" note should use listTripMediaPage.
 */
export async function listTripMedia(tripId: string): Promise<Media[]> {
  return (await listTripMediaPage(tripId)).items;
}

/**
 * Single fresh signed GET URL (server-side only). Prefer issueMediaUrls() for
 * anything the browser will request. Now validates the id shape.
 */
export async function getMediaDownloadUrl(mediaId: string): Promise<string | null> {
  if (!isMediaId(mediaId)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media")
    .select("storage_key")
    .eq("id", mediaId)
    .eq("processing_status", "ready")
    .maybeSingle();

  if (error) {
    console.error("[media] getMediaDownloadUrl lookup failed", {
      code: error.code, message: error.message, details: error.details, hint: error.hint,
    });
    throw new Error("Failed to load media");
  }

  if (!data) return null;
  return createPresignedDownloadUrl(data.storage_key);
}

/**
 * EVERY storage key (any status, so abandoned pending uploads are cleaned too)
 * for a trip, for R2 cleanup before trip deletion. Keyset-paginated and stops
 * only on an empty page, so it is correct under any PostgREST max_rows
 * (the previous single unbounded select was silently capped).
 * Visibility is governed by media_select_member: the trip owner is a member.
 */
export async function listAllStorageKeysForTrip(tripId: string): Promise<string[]> {
  if (!isTripId(tripId)) return [];

  const supabase = await createClient();
  const keys: string[] = [];
  let lastId: string | null = null;

  for (;;) {
    let query = supabase
      .from("media")
      .select("id, storage_key")
      .eq("trip_id", tripId)
      .order("id", { ascending: true })
      .limit(500);
    if (lastId) query = query.gt("id", lastId);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) keys.push(row.storage_key);
    lastId = data[data.length - 1].id;
  }

  return keys;
}
