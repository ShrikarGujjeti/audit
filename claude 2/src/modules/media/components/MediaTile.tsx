"use client";

import { useEffect, useState } from "react";
import type { MediaType } from "@/modules/media/queries";
import { mediaAccessibleName, type AttributionName } from "@/modules/media/accessibleName";

export type MediaTileData = {
  id: string;
  mediaType: MediaType;
  instantMs: number | null;
  durationSeconds: number | null;
  attribution: AttributionName;
  mimeType: string;
};

type TileStatus = "loading" | "loaded" | "failed" | "unavailable";

/** section 14: formats this spec explicitly refuses to promise preview for
 * (HEIC/HEIF, some MOV). The browser itself usually can't decode these, so
 * this is a best-effort guess for which items should go straight to the
 * "unavailable" state rather than trying and failing visibly. */
function isLikelyUnsupportedPreview(mimeType: string): boolean {
  return mimeType === "image/heic" || mimeType === "image/heif";
}

export function MediaTile({
  data,
  url,
  widthPx,
  heightPx,
  timeZone,
  onOpen,
}: {
  data: MediaTileData;
  /** Null while the signed URL hasn't been obtained yet for this tile's
   * load window (section 18) — renders the loading state regardless of
   * whether the underlying fetch has even started. */
  url: string | null;
  widthPx: number;
  heightPx: number;
  timeZone: string;
  onOpen: () => void;
}) {
  const [status, setStatus] = useState<TileStatus>(
    isLikelyUnsupportedPreview(data.mimeType) ? "unavailable" : "loading"
  );
  const [retried, setRetried] = useState(false);

  // One silent retry on failure (section 14), then settle into the failed
  // state. Resets if a fresh url arrives for this same tile.
  useEffect(() => {
    if (url) setRetried(false);
  }, [url]);

  const accessibleName = mediaAccessibleName({
    mediaType: data.mediaType,
    instantMs: data.instantMs,
    durationSeconds: data.durationSeconds,
    attribution: data.attribution,
    timeZone,
  });

  function handleError() {
    if (!retried) {
      setRetried(true); // caller's ensure() loop will naturally re-request on next pass
      return;
    }
    setStatus("failed");
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={accessibleName}
      className="relative block overflow-hidden rounded-[3px] bg-[var(--tc-media-placeholder)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-ink-primary)]"
      style={{ width: widthPx, height: heightPx }}
    >
      {status === "unavailable" || status === "failed" ? (
        <span className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-[var(--tc-ink-secondary)]">
          {status === "unavailable" ? "Can't preview this here." : "Couldn't load. Tap to retry."}
        </span>
      ) : data.mediaType === "video" && url ? (
        <>
          {/* Core per spec v2 section 11: #t=0.001 forces a real first-frame
              preview on browsers (notably iOS Safari) that otherwise show a
              blank rectangle for a <video> with no poster. preload="metadata"
              keeps this bounded to the load window, not the whole trip. */}
          <video
            preload="metadata"
            muted
            playsInline
            src={`${url}#t=0.001`}
            className="h-full w-full object-contain"
            onLoadedMetadata={() => setStatus("loaded")}
            onError={handleError}
          />
          <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
            {formatDurationLabel(data.durationSeconds)}
          </span>
          <PlayGlyph />
        </>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiles use
        // short-lived signed URLs; next/image's remote-domain allowlist
        // and long-lived caching assumptions don't fit this lifecycle.
        <img
          src={url}
          alt=""
          className="h-full w-full object-contain"
          onLoad={() => setStatus("loaded")}
          onError={handleError}
        />
      ) : null}
    </button>
  );
}

function PlayGlyph() {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </span>
  );
}

function formatDurationLabel(durationSeconds: number | null): string {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds < 0) return "0:00";
  const total = Math.round(durationSeconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
