import {
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
  isAllowedMimeType,
  validateDeclaredFileSize,
} from "../validation";
import { MESSAGES, photoTooBigMessage, videoTooBigMessage } from "./messages";
import type {
  PreparedMetadata,
  PutResult,
  RequestUploadResult,
  ServerMediaStatus,
  SessionState,
  UploadDeps,
  UploadFile,
  UploadItem,
  UploadKind,
  UploadQueue,
  UploadQueueOptions,
  UploadSnapshot,
} from "./types";

type Rec = { item: UploadItem; file: UploadFile; abort: AbortController | null; lastProgress: number };

const MIB = 1024 * 1024;
const BUSY = new Set(["requesting", "uploading", "confirming"]);
const isBusy = (r: Rec) => BUSY.has(r.item.status);

const EMPTY_META: PreparedMetadata = { capturedAt: null, width: null, height: null, durationSeconds: null };

/**
 * In-memory upload queue: request -> PUT -> confirm, one item per slot.
 *
 * Invariants (see Phase 6 handoff):
 *  - A signed URL is requested only after an item has acquired a slot, and the
 *    PUT starts immediately, so queued items never hold URLs.
 *  - PUT failure  -> retry plan "restart": new request, NEW mediaId.
 *  - Confirm failure/timeout -> retry plan "confirm": SAME mediaId; status is
 *    reconciled against the server first; the file is never uploaded again.
 *  - Server-returned messages are shown verbatim; they are never parsed.
 *  - Original bytes are handed to the PUT untouched (the File itself).
 */
export function createUploadQueue(deps: UploadDeps, options: UploadQueueOptions = {}): UploadQueue {
  const maxConcurrent = options.maxConcurrent ?? 3;
  const maxVideos = options.maxConcurrentVideos ?? 1;
  const backoff = options.confirmBackoffMs ?? [1000, 3000];
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let seq = 0;
  const newId = options.newId ?? (() => `upload-${++seq}`);

  let recs: Rec[] = [];
  let sessionEnded = false;
  let confirmedSinceDrain = 0;
  let snapshot: UploadSnapshot = { items: [], sessionEnded: false };
  const listeners = new Set<() => void>();

  function emit() {
    snapshot = { items: recs.map((r) => r.item), sessionEnded };
    listeners.forEach((l) => l());
  }
  function patch(rec: Rec, p: Partial<{ -readonly [K in keyof UploadItem]: UploadItem[K] }>) {
    rec.item = { ...rec.item, ...p };
    emit();
  }

  // ------------------------------------------------------------ intake ----

  function preflight(file: UploadFile): { kind: UploadKind; contentType: string } | { rejected: string } {
    const type = (file as Blob).type;
    if (!isAllowedMimeType(type)) return { rejected: MESSAGES.unsupportedType };
    const kind: UploadKind = type.startsWith("image/") ? "photo" : "video";
    if (file.size <= 0) return { rejected: MESSAGES.emptyFile };
    const size = validateDeclaredFileSize(type, file.size);
    if (!size.valid) {
      return {
        rejected:
          kind === "video"
            ? videoTooBigMessage(Math.floor(MAX_VIDEO_BYTES / MIB))
            : photoTooBigMessage(Math.floor(MAX_PHOTO_BYTES / MIB)),
      };
    }
    return { kind, contentType: type };
  }

  function addFiles(files: readonly UploadFile[]) {
    sessionEnded = false;
    for (const file of files) {
      const pre = preflight(file);
      const base = {
        id: newId(),
        fileName: file.name,
        fileSize: file.size,
        progress: null,
        mediaId: null,
        failedStage: null,
        retry: null,
        attempts: 0,
      } as const;
      const item: UploadItem =
        "rejected" in pre
          ? { ...base, contentType: (file as Blob).type, kind: "photo", status: "rejected", message: pre.rejected }
          : { ...base, contentType: pre.contentType, kind: pre.kind, status: "queued", message: null };
      recs.push({ item, file, abort: null, lastProgress: 0 });
    }
    emit();
    pump();
  }

  // ----------------------------------------------------------- scheduler ----

  function pump() {
    if (sessionEnded) return;
    let busy = 0;
    let videos = 0;
    for (const r of recs) {
      if (isBusy(r)) {
        busy++;
        if (r.item.kind === "video") videos++;
      }
    }
    for (const rec of recs) {
      if (busy >= maxConcurrent) break;
      if (rec.item.status !== "queued") continue;
      if (rec.item.kind === "video" && videos >= maxVideos) continue;
      busy++;
      if (rec.item.kind === "video") videos++;
      begin(rec);
    }
  }

  function begin(rec: Rec) {
    const resumeConfirm = rec.item.retry === "confirm" && rec.item.mediaId !== null;
    patch(rec, {
      status: resumeConfirm ? "confirming" : "requesting",
      progress: null,
      message: null,
      failedStage: null,
      attempts: rec.item.attempts + 1,
      ...(resumeConfirm ? {} : { mediaId: null, retry: null }),
    });
    const task = resumeConfirm ? confirmStage(rec, true) : uploadStage(rec);
    task
      .catch(() => {
        // Unexpected bug/exception: fail the item safely, choosing the retry plan
        // that cannot duplicate an upload.
        const hasId = rec.item.mediaId !== null && rec.item.status === "confirming";
        failItem(rec, hasId ? "confirm" : "request", hasId ? "confirm" : "restart", MESSAGES.generic);
      })
      .finally(() => {
        pump();
        checkDrained();
      });
  }

  function checkDrained() {
    if (recs.some(isBusy)) return;
    if (confirmedSinceDrain > 0) {
      confirmedSinceDrain = 0;
      try {
        deps.onDrained();
      } catch {
        /* refresh is best effort */
      }
    }
  }

  // --------------------------------------------------------------- stages ----

  async function isReadable(file: UploadFile): Promise<boolean> {
    try {
      await file.slice(0, 1).arrayBuffer();
      return true;
    } catch {
      return false;
    }
  }

  async function safePrepare(file: UploadFile): Promise<PreparedMetadata> {
    try {
      return await deps.prepare(file);
    } catch {
      return EMPTY_META;
    }
  }

  async function safeProbe(): Promise<SessionState> {
    try {
      return await deps.probeSession();
    } catch {
      return "unknown";
    }
  }

  async function safeStatus(mediaId: string): Promise<ServerMediaStatus | null> {
    try {
      return await deps.getServerStatus(mediaId);
    } catch {
      return null;
    }
  }

  function failItem(
    rec: Rec,
    stage: "request" | "upload" | "confirm",
    plan: "restart" | "confirm",
    message: string
  ) {
    rec.abort = null;
    patch(rec, { status: "failed", failedStage: stage, retry: plan, message, progress: null });
  }

  function markDone(rec: Rec) {
    patch(rec, { status: "done", progress: 1, message: null, failedStage: null, retry: null });
    confirmedSinceDrain++;
    try {
      deps.onConfirmed();
    } catch {
      /* refresh is best effort */
    }
  }

  async function uploadStage(rec: Rec): Promise<void> {
    const { file } = rec;

    if (!(await isReadable(file))) {
      patch(rec, { status: "rejected", message: MESSAGES.unreadable, retry: null });
      return;
    }

    const meta = await safePrepare(file);

    // ---- REQUEST: only now (slot acquired) is a signed URL asked for.
    let res: RequestUploadResult;
    try {
      res = await deps.requestUpload({
        tripId: deps.tripId,
        mimeType: rec.item.contentType,
        fileSizeBytes: file.size,
        originalFilename: file.name,
        ...meta,
      });
    } catch {
      res = { error: MESSAGES.connection };
    }
    if ("error" in res) {
      const session = await safeProbe();
      if (session === "unauthenticated") {
        sessionEnded = true;
        failItem(rec, "request", "restart", MESSAGES.sessionEnded);
      } else {
        failItem(rec, "request", "restart", res.error);
      }
      return;
    }

    // ---- PUT: immediately, with exactly the MIME type that was requested.
    const controller = new AbortController();
    rec.abort = controller;
    rec.lastProgress = 0;
    patch(rec, { mediaId: res.mediaId, status: "uploading", progress: 0 });

    let put: PutResult;
    try {
      put = await deps.putFile({
        url: res.uploadUrl,
        file,
        contentType: rec.item.contentType,
        signal: controller.signal,
        onProgress: (p) => onProgress(rec, p),
      });
    } catch {
      put = { ok: false, reason: "network" };
    }
    rec.abort = null;

    if (!put.ok) {
      if (put.reason === "aborted") {
        patch(rec, { status: "cancelled", progress: null, message: null, retry: null });
      } else {
        // PUT failure -> NEW request / NEW mediaId on retry.
        failItem(rec, "upload", "restart", MESSAGES.connection);
      }
      return;
    }

    await confirmStage(rec, false);
  }

  async function confirmStage(rec: Rec, resumed: boolean): Promise<void> {
    const mediaId = rec.item.mediaId;
    if (!mediaId) {
      failItem(rec, "request", "restart", MESSAGES.generic);
      return;
    }
    patch(rec, { status: "confirming", progress: 1 });

    // Resumed after a confirm failure: the earlier confirm may in fact have landed.
    if (resumed) {
      const s = await safeStatus(mediaId);
      if (s === "ready") return markDone(rec);
      if (s === "failed" || s === "missing") {
        return failItem(rec, "confirm", "restart", MESSAGES.uploadRejected);
      }
    }

    for (let attempt = 0; ; attempt++) {
      let thrown = false;
      let serverMessage: string | null = null;
      try {
        const r = await deps.confirmUpload(mediaId);
        if ("ok" in r) return markDone(rec);
        serverMessage = r.error;
      } catch {
        thrown = true; // timeout / network: outcome UNKNOWN, not "failed"
      }

      // Reconcile: did the server finish it anyway?
      const s = await safeStatus(mediaId);
      if (s === "ready") return markDone(rec);
      if (s === "failed" || s === "missing") {
        return failItem(rec, "confirm", "restart", MESSAGES.uploadRejected);
      }

      if (thrown && attempt < backoff.length) {
        await sleep(backoff[attempt]);
        continue; // same mediaId, never a new upload
      }

      if ((await safeProbe()) === "unauthenticated") {
        sessionEnded = true;
        return failItem(rec, "confirm", "confirm", MESSAGES.sessionEnded);
      }
      return failItem(rec, "confirm", "confirm", serverMessage ?? MESSAGES.connection);
    }
  }

  function onProgress(rec: Rec, p: number) {
    const v = Math.min(1, Math.max(0, p));
    if (v < 1 && Math.abs(v - rec.lastProgress) < 0.01) return;
    rec.lastProgress = v;
    if (rec.item.status === "uploading") patch(rec, { progress: v });
  }

  // ------------------------------------------------------------- commands ----

  const find = (id: string) => recs.find((r) => r.item.id === id);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addFiles,
    retry(id) {
      const rec = find(id);
      if (!rec || rec.item.status !== "failed") return;
      sessionEnded = false;
      const keepId = rec.item.retry === "confirm";
      patch(rec, {
        status: "queued",
        message: null,
        failedStage: null,
        progress: null,
        mediaId: keepId ? rec.item.mediaId : null,
        retry: keepId ? "confirm" : null,
      });
      pump();
    },
    cancel(id) {
      const rec = find(id);
      if (!rec) return;
      if (rec.item.status === "queued") {
        patch(rec, { status: "cancelled", message: null });
        checkDrained();
      } else if (rec.item.status === "uploading") {
        rec.abort?.abort(); // result handled in uploadStage
      }
      // requesting / confirming: server work is underway, not cancellable.
    },
    dismiss(id) {
      const rec = find(id);
      if (!rec || isBusy(rec) || rec.item.status === "queued") return;
      recs = recs.filter((r) => r !== rec);
      emit();
    },
    clearFinished() {
      recs = recs.filter((r) => !["done", "rejected", "cancelled"].includes(r.item.status));
      emit();
    },
    cancelAll() {
      for (const r of recs) {
        if (r.item.status === "queued") patch(r, { status: "cancelled", message: null });
        else if (r.item.status === "uploading") r.abort?.abort();
      }
    },
  };
}
