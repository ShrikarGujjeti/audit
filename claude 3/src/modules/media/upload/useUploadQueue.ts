"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { confirmMediaUploadAction, requestMediaUploadAction } from "@/modules/media/actions";
import { putFileXhr } from "./browser-put";
import { prepareFileMetadata } from "./browser-measure";
import { probeBrowserSession } from "./browser-session";
import { createRefreshCoalescer } from "./coalesce";
import { MESSAGES } from "./messages";
import { createUploadQueue } from "./queue";
import { getUploadStatusAction } from "./status-action";
import type { UploadDeps, UploadQueue, UploadSnapshot } from "./types";

/** [H] Window for coalescing "new media confirmed" into one page refresh. */
const REFRESH_DELAY_MS = 1500;

const EMPTY: UploadSnapshot = { items: [], sessionEnded: false };

/**
 * Wires the framework-independent queue to the real Server Actions, the browser
 * PUT, and router.refresh() (which re-renders the trip's Server Components —
 * including whatever timeline the page renders — without resetting scroll or
 * client state). Queue lives in memory only and is torn down on unmount.
 */
export function useUploadQueue(tripId: string) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const mounted = useRef(true);

  const [queue] = useState<UploadQueue>(() => {
    const coalescer = createRefreshCoalescer(
      () => {
        if (mounted.current) routerRef.current.refresh();
      },
      { delayMs: REFRESH_DELAY_MS }
    );
    const deps: UploadDeps = {
      tripId,
      prepare: prepareFileMetadata,
      async requestUpload(input) {
        const r = await requestMediaUploadAction(input);
        if (r.mediaId && r.uploadUrl) return { mediaId: r.mediaId, uploadUrl: r.uploadUrl };
        return { error: r.error ?? MESSAGES.generic };
      },
      putFile: putFileXhr,
      async confirmUpload(mediaId) {
        const r = await confirmMediaUploadAction({ mediaId });
        if (r.error) return { error: r.error };
        return r.success ? { ok: true } : { error: MESSAGES.generic };
      },
      async getServerStatus(mediaId) {
        const r = await getUploadStatusAction(mediaId);
        return "status" in r ? r.status : null;
      },
      probeSession: probeBrowserSession,
      onConfirmed: () => coalescer.trigger(),
      onDrained: () => coalescer.flush(),
    };
    return createUploadQueue(deps);
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queue.cancelAll(); // aborts running PUTs; the queue does not outlive the page
    };
  }, [queue]);

  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => EMPTY);
  return { queue, snapshot };
}
