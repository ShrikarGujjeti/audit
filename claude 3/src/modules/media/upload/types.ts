/**
 * Framework-independent types for the Phase 6 upload queue (no DOM-only or
 * Next.js imports here, so the same rules can later be reused by a native
 * client — spec Appendix G #1).
 */

/** A browser File, or anything Blob-like with a name (tests use plain Files). */
export type UploadFile = Blob & { readonly name: string };

export type UploadStatus =
  | "queued"
  | "requesting"
  | "uploading"
  | "confirming"
  | "done"
  | "failed"
  | "rejected"
  | "cancelled";

/** Which step a failed item stopped at. */
export type FailureStage = "request" | "upload" | "confirm";

/**
 * What "Try again" means for a failed item. This is the duplicate-prevention
 * invariant made explicit:
 *   "restart" -> new request, NEW mediaId, new signed URL, new PUT
 *   "confirm" -> SAME mediaId; reconcile, then confirm again; never re-upload
 */
export type RetryPlan = "restart" | "confirm";

export type UploadKind = "photo" | "video";

/** Plain, immutable, serialisable view of one queue entry (no File inside). */
export type UploadItem = Readonly<{
  id: string;
  fileName: string;
  fileSize: number;
  /** Exactly the MIME type sent to request_media_upload AND used for the PUT. */
  contentType: string;
  kind: UploadKind;
  status: UploadStatus;
  /** 0..1 while uploading, otherwise null (null while uploading = indeterminate). */
  progress: number | null;
  mediaId: string | null;
  /** User-facing message for failed / rejected items. */
  message: string | null;
  failedStage: FailureStage | null;
  /**
   * For a "failed" item: what retry will do. For a re-queued item: "confirm"
   * means "resume at confirm with the same mediaId", null means "start fresh".
   */
  retry: RetryPlan | null;
  attempts: number;
}>;

export type UploadSnapshot = Readonly<{
  items: readonly UploadItem[];
  /** Set when a failure was traced to an ended session; new work is paused. */
  sessionEnded: boolean;
}>;

/** Result of local metadata preparation. Always sanitised; never throws. */
export type PreparedMetadata = {
  capturedAt: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

export type RequestUploadInput = PreparedMetadata & {
  tripId: string;
  mimeType: string;
  fileSizeBytes: number;
  originalFilename: string;
};

/** Mirrors requestMediaUploadAction's result, normalised. */
export type RequestUploadResult =
  | { mediaId: string; uploadUrl: string }
  | { error: string };

export type PutResult =
  | { ok: true }
  | { ok: false; reason: "http" | "network" | "stalled" | "aborted"; status?: number };

export type ConfirmResult = { ok: true } | { error: string };

/** processing_status of the caller's own media row, or "missing". */
export type ServerMediaStatus = "pending" | "processing" | "ready" | "failed" | "missing";

export type SessionState = "authenticated" | "unauthenticated" | "unknown";

export interface UploadDeps {
  tripId: string;
  prepare(file: UploadFile): Promise<PreparedMetadata>;
  requestUpload(input: RequestUploadInput): Promise<RequestUploadResult>;
  putFile(args: {
    url: string;
    file: UploadFile;
    contentType: string;
    signal: AbortSignal;
    onProgress: (fraction: number) => void;
  }): Promise<PutResult>;
  confirmUpload(mediaId: string): Promise<ConfirmResult>;
  /** null = could not be determined (network etc.). Must not throw ideally. */
  getServerStatus(mediaId: string): Promise<ServerMediaStatus | null>;
  probeSession(): Promise<SessionState>;
  /** Called once for every item that reaches "done". */
  onConfirmed(): void;
  /** Called when no item is busy any more and something was confirmed since last time. */
  onDrained(): void;
}

export interface UploadQueueOptions {
  /** [H] Max simultaneous items (each holds one signed URL while active). */
  maxConcurrent?: number;
  /** [H] Max simultaneous videos (large originals, mobile memory). */
  maxConcurrentVideos?: number;
  /** [H] Delays before automatic confirm re-attempts after a *thrown* confirm. */
  confirmBackoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  newId?: () => string;
}

export interface UploadQueue {
  getSnapshot(): UploadSnapshot;
  subscribe(listener: () => void): () => void;
  addFiles(files: readonly UploadFile[]): void;
  retry(id: string): void;
  /** queued -> cancelled; uploading -> aborts the PUT; requesting/confirming are not cancellable. */
  cancel(id: string): void;
  dismiss(id: string): void;
  clearFinished(): void;
  /** Cancels queued items and aborts running PUTs (used on unmount). */
  cancelAll(): void;
}
