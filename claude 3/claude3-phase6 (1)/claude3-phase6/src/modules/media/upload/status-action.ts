"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/modules/auth/session";
import { isMediaId } from "../validation";

export type UploadStatusResult =
  | { status: "pending" | "processing" | "ready" | "failed" | "missing" }
  | { error: string };

/**
 * Read-only reconciliation helper for the upload queue: the processing_status
 * of the CALLER'S OWN media row. Used after a confirm timeout/failure to learn
 * whether the confirm actually landed (so a timeout never becomes a duplicate
 * upload). Same scoping as confirmMediaUploadAction's lookup (uploader_id =
 * caller, via the existing media SELECT RLS); no new privilege, no new SQL.
 * A row that is absent and one that is not the caller's are indistinguishable.
 */
export async function getUploadStatusAction(mediaId: string): Promise<UploadStatusResult> {
  if (!isMediaId(mediaId)) return { status: "missing" };

  const userId = await getCurrentUserId();
  if (!userId) return { error: "You must be signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media")
    .select("processing_status")
    .eq("id", mediaId)
    .eq("uploader_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[media] getUploadStatus failed", { code: error.code, message: error.message });
    return { error: "Could not check the upload." };
  }
  if (!data) return { status: "missing" };
  return { status: data.processing_status as "pending" | "processing" | "ready" | "failed" };
}
