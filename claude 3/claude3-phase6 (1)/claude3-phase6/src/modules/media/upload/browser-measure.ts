import { fileRangeReader, readExifDateTime } from "./exif";
import { resolveCapturedAt, sanitizeMetadata } from "./metadata";
import type { PreparedMetadata, UploadFile } from "./types";

const MEASURE_TIMEOUT_MS = 10_000; // [H]

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    );
  });
}

// One image decode at a time: decoding a 25 MiB photo can briefly cost far more
// memory than the file itself, and several in parallel is a mobile OOM risk.
let decodeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = decodeChain.then(fn, fn);
  decodeChain = run.catch(() => undefined);
  return run;
}

/** Orientation-applied size via browser decode. null if the browser cannot decode (e.g. HEIC outside Safari). */
async function measureImage(file: UploadFile): Promise<{ width: number; height: number } | null> {
  return serialized(async () => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      img.src = url;
      await withTimeout(img.decode(), MEASURE_TIMEOUT_MS);
      return { width: img.naturalWidth, height: img.naturalHeight };
    } catch {
      return null;
    } finally {
      img.removeAttribute("src");
      URL.revokeObjectURL(url);
    }
  });
}

async function measureVideo(
  file: UploadFile
): Promise<{ width: number; height: number; duration: number } | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const loaded = new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video metadata"));
    });
    video.src = url;
    await withTimeout(loaded, MEASURE_TIMEOUT_MS);
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Local metadata for one file. Never throws; anything unknown stays null.
 * captured_at is EXIF-or-null only (File.lastModified is deliberately NOT used);
 * videos therefore have no capture time in Phase 6.
 */
export async function prepareFileMetadata(file: UploadFile): Promise<PreparedMetadata> {
  try {
    if (file.type.startsWith("image/")) {
      const [exif, size] = await Promise.all([
        readExifDateTime(fileRangeReader(file), file.size),
        measureImage(file),
      ]);
      return sanitizeMetadata({
        capturedAt: resolveCapturedAt(exif),
        width: size?.width,
        height: size?.height,
      });
    }
    const v = await measureVideo(file);
    return sanitizeMetadata({ width: v?.width, height: v?.height, durationSeconds: v?.duration });
  } catch {
    return sanitizeMetadata({});
  }
}
