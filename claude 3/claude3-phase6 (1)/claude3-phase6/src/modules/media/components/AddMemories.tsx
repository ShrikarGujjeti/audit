"use client";

import { useEffect, useRef } from "react";
import { ALLOWED_MIME_TYPES } from "@/modules/media/validation";
import { summarizeQueue } from "@/modules/media/upload/summary";
import { useUploadQueue } from "@/modules/media/upload/useUploadQueue";
import { UploadTray } from "./UploadTray";

/** Same list the backend allows (migration 0012 / media/validation.ts). Not a security boundary. */
const ACCEPT = ALLOWED_MIME_TYPES.join(",");

/**
 * "Add memories": opens the native multi-file picker and runs the in-memory
 * upload queue. Self-contained: after uploads are confirmed it calls
 * router.refresh(), so any Server Component timeline on the page re-reads the
 * media list; it owns no media dataset of its own.
 */
export function AddMemories({ tripId, tripName }: { tripId: string; tripName: string }) {
  const { queue, snapshot } = useUploadQueue(tripId);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = summarizeQueue(snapshot.items).isActive;

  // Uploads need this tab to stay open. beforeunload covers reload/close/hard
  // navigation; it does NOT see in-app client-side navigation (known gap).
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-11 items-center rounded-md bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
      >
        Add memories
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          // Copy BEFORE clearing: FileList is live and is emptied by resetting value.
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) queue.addFiles(files);
        }}
      />
      <UploadTray queue={queue} snapshot={snapshot} tripId={tripId} tripName={tripName} />
    </>
  );
}
