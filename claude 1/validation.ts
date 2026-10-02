export type ValidationResult = { valid: true } | { valid: false; error: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Well-formedness check for a media id (not authorization). Accepts unknown
 * because values arrive from the network where TypeScript types are not
 * enforced at runtime.
 */
export function isMediaId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Mirrors media_type_for_mime() in 0012. The SQL function is authoritative. */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const MAX_PHOTO_BYTES = 25 * 1024 * 1024; // mirrors max_media_bytes_for_type('photo')
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // mirrors max_media_bytes_for_type('video')
const MAX_FILENAME_LENGTH = 255;

export function isAllowedMimeType(mimeType: unknown): mimeType is AllowedMimeType {
  return typeof mimeType === "string" && (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

function isPhotoMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function validateDeclaredFileSize(mimeType: string, fileSizeBytes: unknown): ValidationResult {
  if (typeof fileSizeBytes !== "number" || !Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return { valid: false, error: "Invalid file size." };
  }
  const max = isPhotoMime(mimeType) ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
  if (fileSizeBytes > max) {
    return { valid: false, error: `File exceeds the ${Math.floor(max / (1024 * 1024))} MB limit.` };
  }
  return { valid: true };
}

/** Untrusted display metadata: length-limited, never used to build a storage key. */
export function sanitizeOriginalFilename(filename: unknown): string | null {
  if (typeof filename !== "string") return null;
  const trimmed = filename.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FILENAME_LENGTH);
}

// ---- Metadata sanitizers (data quality, not security). The database
// (0016 request_media_upload) applies the same bounds authoritatively. ----

export function sanitizeDimension(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 100000 ? value : null;
}

export function sanitizeDurationSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 0 && value <= 86400 ? value : null;
}

const MIN_CAPTURED_AT_MS = Date.UTC(1990, 0, 1);
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/** Returns a canonical ISO string, or null if missing/unparseable/implausible. */
export function sanitizeCapturedAt(value: unknown, nowMs: number = Date.now()): string | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  if (ms < MIN_CAPTURED_AT_MS || ms > nowMs + MAX_FUTURE_SKEW_MS) return null;
  return new Date(ms).toISOString();
}

/** Upper bound on ids per signed-URL request (>= the viewer/grid window size). */
export const MAX_URLS_PER_REQUEST = 60;
