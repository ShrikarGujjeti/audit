import type { PreparedMetadata } from "./types";

/** [H] Capture times before this are treated as bogus camera-clock defaults. */
export const MIN_CAPTURE_TIME_MS = Date.UTC(1990, 0, 1);
/** [H] Guards against absurd decoded values overflowing the DB integer columns. */
export const MAX_DIMENSION = 100_000;

export type ExifDateTime = { dateTime: string; offset: string | null };

const DATE_RE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;

/**
 * EXIF DateTimeOriginal (+ OffsetTimeOriginal when present) -> ISO UTC string,
 * or null. With an offset the instant is exact; without one the wall-clock time
 * is interpreted in the uploader's browser time zone (a known approximation,
 * spec OD5). Anything invalid, before 1990 or in the future -> null.
 * File.lastModified is deliberately never consulted.
 */
export function resolveCapturedAt(exif: ExifDateTime | null, now: Date = new Date()): string | null {
  if (!exif) return null;
  const m = DATE_RE.exec(exif.dateTime.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;

  // Calendar validity (rejects 2026:02:30 instead of letting it roll over).
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }

  let ms: number;
  const off = exif.offset ? OFFSET_RE.exec(exif.offset.trim()) : null;
  if (off) {
    const oh = Number(off[2]);
    const om = Number(off[3]);
    if (oh > 14 || om > 59) return null;
    const sign = off[1] === "-" ? -1 : 1;
    ms = Date.UTC(y, mo - 1, d, h, mi, s) - sign * (oh * 60 + om) * 60_000;
  } else {
    ms = new Date(y, mo - 1, d, h, mi, s).getTime();
  }

  if (!Number.isFinite(ms)) return null;
  if (ms < MIN_CAPTURE_TIME_MS || ms > now.getTime()) return null;
  return new Date(ms).toISOString();
}

function positiveInt(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  const r = Math.round(v);
  return r >= 1 && r <= MAX_DIMENSION ? r : null;
}

function positiveDuration(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 1000) / 1000;
}

/** Final defensive pass before anything is sent. Client metadata stays untrusted. */
export function sanitizeMetadata(
  raw: { capturedAt?: string | null; width?: number | null; height?: number | null; durationSeconds?: number | null },
  now: Date = new Date()
): PreparedMetadata {
  let capturedAt: string | null = null;
  if (raw.capturedAt) {
    const ms = Date.parse(raw.capturedAt);
    if (Number.isFinite(ms) && ms >= MIN_CAPTURE_TIME_MS && ms <= now.getTime()) {
      capturedAt = new Date(ms).toISOString();
    }
  }
  const width = positiveInt(raw.width);
  const height = positiveInt(raw.height);
  // A half-known size is useless for layout; keep both or neither.
  return {
    capturedAt,
    width: width !== null && height !== null ? width : null,
    height: width !== null && height !== null ? height : null,
    durationSeconds: positiveDuration(raw.durationSeconds),
  };
}
