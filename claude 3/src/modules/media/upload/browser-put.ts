import type { PutResult, UploadFile } from "./types";

/** [H] No upload progress for this long => treat the PUT as stalled. */
export const PUT_STALL_MS = 60_000;

/**
 * Browser PUT of the ORIGINAL File (never read into JS memory) to a signed URL.
 * XHR is used because fetch() has no upload progress. The Content-Type header
 * is exactly the one the URL was signed for. The signed URL is never logged.
 */
export function putFileXhr(args: {
  url: string;
  file: UploadFile;
  contentType: string;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
}): Promise<PutResult> {
  const { url, file, contentType, signal, onProgress } = args;
  return new Promise<PutResult>((resolve) => {
    if (signal.aborted) return resolve({ ok: false, reason: "aborted" });

    const xhr = new XMLHttpRequest();
    let settled = false;
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (r: PutResult) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      signal.removeEventListener("abort", onAbort);
      resolve(r);
    };
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, PUT_STALL_MS);
    };
    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort);

    xhr.upload.onprogress = (e) => {
      armStall();
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? finish({ ok: true })
        : finish({ ok: false, reason: "http", status: xhr.status });
    // status 0 here is also what a CORS failure looks like; the browser hides the cause.
    xhr.onerror = () => finish({ ok: false, reason: "network" });
    xhr.onabort = () => finish({ ok: false, reason: stalled ? "stalled" : "aborted" });

    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    armStall();
    xhr.send(file);
  });
}
