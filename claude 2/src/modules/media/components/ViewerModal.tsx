"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { MediaTileData } from "./MediaTile";
import { useSignedUrls } from "@/modules/media/useSignedUrls";
import { mediaAccessibleName, viewerPositionAnnouncement } from "@/modules/media/accessibleName";
import { RemoveMediaButton } from "./RemoveMediaButton";

export type ViewerItem = {
  data: MediaTileData;
  canRemove: boolean;
};

const VIEWER_PARAM = "media";

/** Reads/writes the open item via the ?media=<id> search param (spec
 * section 11: "the `?media=` value is the media id, never a signed URL").
 * Pushing/replacing history here is what makes Back close the viewer. */
export function useViewerRouting() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openId = searchParams.get(VIEWER_PARAM);

  const open = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(VIEWER_PARAM, id);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const close = useCallback(() => {
    // router.back() rather than push-without-param, so the browser Back
    // button and an explicit close button both land the user on the exact
    // prior history entry (section 7/12: "the viewer participates in
    // browser history... back closes the viewer").
    router.back();
  }, [router]);

  const navigateTo = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(VIEWER_PARAM, id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { openId, open, close, navigateTo };
}

export function ViewerModal({
  items,
  openId,
  onClose,
  onNavigate,
  timeZone,
}: {
  /** Full ordered list — already scoped by the active person filter when
   * that Tier-2 feature exists; Phase 6 Core passes the whole trip. */
  items: ViewerItem[];
  openId: string | null;
  onClose: () => void;
  onNavigate: (id: string) => void;
  timeZone: string;
}) {
  const index = useMemo(() => items.findIndex((i) => i.data.id === openId), [items, openId]);
  const current = index >= 0 ? items[index] : null;
  const { get, ensure, fetchFresh } = useSignedUrls();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Request a URL for the current item plus its immediate neighbours only
  // (section 11: "prefetch at most the adjacent next and previous items").
  useEffect(() => {
    if (!current) return;
    const neighbourIds = [items[index - 1]?.data.id, current.data.id, items[index + 1]?.data.id].filter(
      (id): id is string => !!id
    );
    void ensure(neighbourIds);
  }, [current, index, items, ensure]);

  // Focus trap + restore-on-close (section 17).
  useEffect(() => {
    if (!current) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [current]);

  const goPrev = useCallback(() => {
    if (index > 0) onNavigate(items[index - 1].data.id);
  }, [index, items, onNavigate]);

  const goNext = useCallback(() => {
    if (index >= 0 && index < items.length - 1) onNavigate(items[index + 1].data.id);
  }, [index, items, onNavigate]);

  useEffect(() => {
    if (!current) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, onClose, goPrev, goNext]);

  if (!current) return null;

  const url = get(current.data.id);
  const accessibleName = mediaAccessibleName({
    mediaType: current.data.mediaType,
    instantMs: current.data.instantMs,
    durationSeconds: current.data.durationSeconds,
    attribution: current.data.attribution,
    timeZone,
  });

  async function handleOpenOriginal() {
    const fresh = await fetchFresh(current!.data.id);
    if (fresh) window.open(fresh, "_blank", "noopener");
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={accessibleName}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 text-xl">
          ✕
        </button>
        <span aria-live="polite" className="text-sm tabular-nums">
          {viewerPositionAnnouncement({ mediaType: current.data.mediaType, index1Based: index + 1, total: items.length })}
        </span>
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          aria-label="Details"
          aria-pressed={detailsOpen}
          className="h-11 w-11 text-sm underline"
        >
          info
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {index > 0 ? (
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous"
            className="absolute left-2 z-10 h-11 w-11 text-white"
          >
            ‹
          </button>
        ) : null}

        {url ? (
          current.data.mediaType === "video" ? (
            <video src={url} controls playsInline className="max-h-[85vh] max-w-[85vw]" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, see MediaTile.
            <img src={url} alt="" className="max-h-[85vh] max-w-[85vw] object-contain" />
          )
        ) : (
          <p className="text-sm text-white/70">Loading…</p>
        )}

        {index < items.length - 1 ? (
          <button
            type="button"
            onClick={goNext}
            aria-label="Next"
            className="absolute right-2 z-10 h-11 w-11 text-white"
          >
            ›
          </button>
        ) : null}
      </div>

      {detailsOpen ? (
        <div className="bg-[var(--tc-surface-raised-dark,theme(colors.neutral.900))] p-4 text-sm text-white">
          <p>{accessibleName}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={handleOpenOriginal} className="rounded-md border border-white/30 px-3 py-2">
              Open original
            </button>
            <RemoveMediaButton mediaId={current.data.id} canRemove={current.canRemove} onRemoved={() => (index < items.length - 1 ? goNext() : onClose())} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
