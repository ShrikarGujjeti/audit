export type ValidationResult = { valid: true } | { valid: false; error: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMediaId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

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

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 255;

export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

function isPhotoMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function validateDeclaredFileSize(mimeType: string, fileSizeBytes: number): ValidationResult {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return { valid: false, error: "Invalid file size." };
  }
  const max = isPhotoMime(mimeType) ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
  if (fileSizeBytes > max) {
    return { valid: false, error: `File exceeds the ${Math.floor(max / (1024 * 1024))} MB limit.` };
  }
  return { valid: true };
}

export function sanitizeOriginalFilename(filename: string | null | undefined): string | null {
  if (!filename) return null;
  const trimmed = filename.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FILENAME_LENGTH);
}
