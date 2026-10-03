"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentUserId } from "@/modules/auth/session";
import { isTripId } from "@/modules/trips/validation";
import {
  isAllowedMimeType,
  isMediaId,
  validateDeclaredFileSize,
  sanitizeOriginalFilename,
} from "./validation";
import {
  createPresignedUploadUrl,
  headMediaObject,
  deleteMediaObjectBestEffort,
} from "@/modules/storage/r2";

export type RequestUploadState = { error?: string; mediaId?: string; uploadUrl?: string };
export type ConfirmUploadState = { error?: string; success?: string };
export type DeleteMediaState = { error?: string; success?: string };

function logDatabaseError(operation: string, error: PostgrestError): void {
  console.error(`[media] ${operation} failed`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

export async function requestMediaUploadAction(input: {
  tripId: string;
  mimeType: string;
  fileSizeBytes: number;
  originalFilename?: string | null;
  capturedAt?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}): Promise<RequestUploadState> {
  const { tripId, mimeType, fileSizeBytes } = input;

  if (!isTripId(tripId)) return { error: "This trip could not be found." };
  if (!isAllowedMimeType(mimeType)) return { error: "This file type isn't supported." };

  const sizeCheck = validateDeclaredFileSize(mimeType, fileSizeBytes);
  if (!sizeCheck.valid) return { error: sizeCheck.error };

  const userId = await getCurrentUserId();
  if (!userId) return { error: "You must be signed in to upload media." };

  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("request_media_upload", {
      p_trip_id: tripId,
      p_mime_type: mimeType,
      p_file_size_bytes: fileSizeBytes,
      p_original_filename: sanitizeOriginalFilename(input.originalFilename),
      p_captured_at: input.capturedAt ?? null,
      p_width: input.width ?? null,
      p_height: input.height ?? null,
      p_duration_seconds: input.durationSeconds ?? null,
    })
    .single();

  if (error || !data) {
    if (error) logDatabaseError("request_media_upload", error);
    return { error: "Could not start the upload. Please try again." };
  }

  const row = data as { media_id: string; storage_key: string };

  try {
    const uploadUrl = await createPresignedUploadUrl(row.storage_key, mimeType);
    return { mediaId: row.media_id, uploadUrl };
  } catch (err) {
    console.error("[media] presign failed", err);
    return { error: "Could not prepare the upload. Please try again." };
  }
}

export async function confirmMediaUploadAction(input: {
  mediaId: string;
}): Promise<ConfirmUploadState> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { error: "You must be signed in to confirm this upload." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("media")
    .select("storage_key, processing_status")
    .eq("id", input.mediaId)
    .eq("uploader_id", userId)
    .maybeSingle();

  if (error) {
    logDatabaseError("confirm_media_upload (lookup)", error);
    return { error: "Could not confirm the upload. Please try again." };
  }

  if (!data) {
    return { error: "This upload could not be found." };
  }

  if (data.processing_status !== "pending") {
    return { error: "This upload has already been processed." };
  }

  const head = await headMediaObject(data.storage_key);
  if (!head) {
    return { error: "We couldn't find the uploaded file yet. Please try uploading again." };
  }

  const serviceClient = createServiceClient();
  const { error: rpcError } = await serviceClient.rpc("confirm_media_upload", {
    p_media_id: input.mediaId,
    p_actual_file_size_bytes: head.sizeBytes,
    p_caller_id: userId,
  });

  if (rpcError) {
    logDatabaseError("confirm_media_upload", rpcError);
    return { error: "Could not confirm the upload. Please try again." };
  }

  return { success: "Upload complete." };
}

export async function deleteMediaAction(
  _prevState: DeleteMediaState,
  formData: FormData
): Promise<DeleteMediaState> {
  const mediaId = String(formData.get("mediaId") ?? "");

  if (!isMediaId(mediaId)) {
    return { error: "This media item could not be found." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("media")
    .delete()
    .eq("id", mediaId)
    .select("storage_key, trip_id")
    .maybeSingle();

  if (error) {
    logDatabaseError("delete", error);
    return { error: "Could not delete this media item. Please try again." };
  }

  if (!data) {
    return {
      error: "This media item could not be found, or you don't have permission to delete it.",
    };
  }

  await deleteMediaObjectBestEffort(data.storage_key, { mediaId });

  revalidatePath(`/trips/${data.trip_id}`);

  return { success: "Media deleted." };
}
