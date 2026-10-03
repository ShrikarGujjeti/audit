/**
 * Pure timeline/chronology logic for the Phase 6 media experience.
 *
 * Deliberately framework-independent: no DOM, no React, no Next.js imports.
 * This is the "pure product rules" module Appendix G of the Phase 6 spec
 * asks for, so a future native client can reproduce identical grouping,
 * clustering and featured-tile behavior without re-deriving it.
 *
 * Every rule here implements something already decided in
 * TRIP_CHALO_PHASE6_EXPERIENCE_SPEC_v2.md section 10 (T1-T10) and section 5
 * (featured tiles, untrusted-dimension handling). Comments cite the spec
 * tag ([D]/[R]/[H]) so a reviewer can see which parts are binding and which
 * are tunable hypotheses.
 */

import type { Media } from "./queries";

// ============ Shared types ============

/** The subset of Media fields the timeline actually needs, so pure
 * functions here don't have to import the full server type everywhere
 * they're used (e.g. from a future native client with its own Media type). */
export type TimelineMedia = Pick<
  Media,
  | "id"
  | "uploader_id"
  | "media_type"
  | "captured_at"
  | "uploaded_at"
  | "created_at"
  | "width"
  | "height"
  | "duration_seconds"
>;

export type SanitizedDimensions = { width: number; height: number } | null;

export type TimelineItem<M extends TimelineMedia = TimelineMedia> = {
  media: M;
  /** Sanitized, never trusted as-authoritative client input (spec section 5 /
   * section 0.4 "untrusted metadata"). Null when the client-supplied value
   * was missing, non-finite, or <= 0. */
  dimensions: SanitizedDimensions;
  /** The single instant used for all ordering and grouping decisions below. */
  sortInstant: number;
};

export type DayGroup<M extends TimelineMedia = TimelineMedia> = {
  /** Calendar date in the display time zone, "YYYY-MM-DD". Never a Date
   * object: comparing plain calendar-date strings avoids re-introducing a
   * timezone into a value that is conceptually a date, not an instant. */
  dateKey: string;
  /** 1-based day number ("Day N") if the trip has a start_date and this day
   * falls within [start_date, end_date] inclusive (treated as plain
   * calendar dates, not instants — see computeDayGroups doc comment).
   * Null when there's no trip start_date or the day falls outside the
   * trip's date range (T4: "only if the trip has a start date and the day
   * falls within it"). */
  dayNumber: number | null;
  items: TimelineItem<M>[];
};

export type Cluster<M extends TimelineMedia = TimelineMedia> = {
  /** The instant of the first item in the cluster — what the time marker
   * displays (T6: "time is shown precisely"). */
  markerInstant: number;
  /** True if this cluster is the first in its day, OR immediately follows a
   * gap >= GAP_THRESHOLD_SECONDS from the previous item in timeline order.
   * Drives both the time-marker-visibility rule (T6) and the featured-tile
   * trigger (spec section 5). */
  startsNewCluster: boolean;
  items: TimelineItem<M>[];
};

// ============ Tunable constants — all [H] per the spec ============

/** T2 [R]: calendar-day boundary. Midnight is the spec's starting constant;
 * a later-night offset (e.g. 4am) is explicitly [H] and unvalidated. Kept
 * as a single named constant so it can change without touching the
 * grouping algorithm itself. */
export const DAY_BOUNDARY_HOUR = 0;

/** T6 [H]: gap, in seconds, that starts a new time-marker cluster. */
export const CLUSTER_GAP_SECONDS = 30 * 60;

/** Section 5 [R]: last-row justified-layout stretch cap. Exported here (not
 * just in the layout component) because the featured-tile rule needs to
 * know about it to decide when to skip a feature — see isFeatured(). */
export const LAST_ROW_MAX_STRETCH = 1.3;

/** Section 5 [H]: acceptable aspect-ratio range after clamping. Anything
 * outside this range is still rendered (never cropped — P7) but the layout
 * treats it as if it were at the nearest bound, so one extreme panorama or
 * extreme portrait can't break a whole row. */
export const MIN_ASPECT_RATIO = 1 / 4;
export const MAX_ASPECT_RATIO = 8;

/** Section 13 [H]: sanity bounds for capture time. A capture_at outside
 * this range is almost certainly a client clock/EXIF error and should be
 * treated as if it were absent (Undated) rather than rendered as a
 * precise, wrong instant. */
export const CAPTURED_AT_MIN = Date.UTC(1990, 0, 1);
export function capturedAtMaxNow(now: number = Date.now()): number {
  return now;
}

// ============ Untrusted metadata (section 0.4 / section 5) ============

/**
 * width/height are client-supplied and never validated server-side
 * (confirmed against request_media_upload, migration 0012 — it accepts
 * p_width/p_height with no range check). Non-finite or <= 0 values are
 * treated as absent, matching "a non-finite or <= 0 value is treated as
 * null" (spec section 5). The caller is responsible for actually measuring
 * dimensions via browser decode when uploading (OD5 territory) — this
 * function only defends the read path against whatever ends up in the
 * database, including rows written before that discipline existed.
 */
export function sanitizeDimensions(
  width: number | null,
  height: number | null
): SanitizedDimensions {
  if (width == null || height == null) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Clamps an aspect ratio (width/height) into [MIN_ASPECT_RATIO,
 * MAX_ASPECT_RATIO] for LAYOUT PURPOSES ONLY. This never changes what is
 * rendered in the viewer (P7: never crop or hide a photo) — it only stops
 * one extreme panorama from making a justified-row algorithm produce an
 * absurd row height for every other photo sharing that row.
 */
export function clampAspectRatio(dimensions: SanitizedDimensions): number {
  if (!dimensions) return 1; // a null-dimension tile reserves a 4:3-ish box; see spec section 5.
  const ratio = dimensions.width / dimensions.height;
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, ratio));
}

/**
 * Section 13 [H]: drop a capture time that is non-finite or outside the
 * sane range, treating the item as if captured_at had been null. This is
 * a read-time defense; it does not and cannot correct the stored value
 * (media rows are not updatable — 0008 grants no UPDATE on media).
 */
export function sanitizeCapturedAt(
  capturedAt: string | null,
  now: number = Date.now()
): number | null {
  if (!capturedAt) return null;
  const parsed = Date.parse(capturedAt);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < CAPTURED_AT_MIN || parsed > capturedAtMaxNow(now)) return null;
  return parsed;
}

// ============ T1 / T5: ordering and the Undated partition ============

/**
 * T1 [D] + T5 [R]: the flow is ordered by capture time. Items without a
 * (sane) capture time are NEVER placed by upload time inside a day — they
 * only ever appear in the Undated section, ordered by upload time there.
 *
 * This is why the partition below is `captured_at IS NULL` (after
 * sanitization), not an ordering by `chronology_at` (the database's
 * COALESCE(captured_at, uploaded_at) column, migration 0012): chronology_at
 * is the right single sort key for the DATABASE QUERY (listTripMedia already
 * uses it, and it's indexed), but presenting it directly would interleave
 * undated items into days by their upload time, which the spec explicitly
 * rejects (T1/T5 reconciliation, v1 audit finding).
 */
export function buildTimelineItems<M extends TimelineMedia>(
  media: M[],
  now: number = Date.now()
): { dated: TimelineItem<M>[]; undated: TimelineItem<M>[] } {
  const dated: TimelineItem<M>[] = [];
  const undated: TimelineItem<M>[] = [];

  for (const item of media) {
    const dimensions = sanitizeDimensions(item.width, item.height);
    const capturedAtMs = sanitizeCapturedAt(item.captured_at, now);

    if (capturedAtMs !== null) {
      dated.push({ media: item, dimensions, sortInstant: capturedAtMs });
    } else {
      const uploadedAtMs = item.uploaded_at
        ? Date.parse(item.uploaded_at)
        : Date.parse(item.created_at);
      undated.push({
        media: item,
        dimensions,
        sortInstant: Number.isFinite(uploadedAtMs) ? uploadedAtMs : 0,
      });
    }
  }

  // listTripMedia already returns rows ordered by chronology_at then id.
  // Re-sorting here is deliberate defense, not an assumption that the
  // caller always passes database order (e.g. after a client-side
  // optimistic insert) — and it makes this module correct in isolation,
  // which is the point of keeping it pure/testable (Appendix G).
  const byInstantThenId = (a: TimelineItem<M>, b: TimelineItem<M>) =>
    a.sortInstant - b.sortInstant || a.media.id.localeCompare(b.media.id);

  dated.sort(byInstantThenId);
  undated.sort(byInstantThenId);

  return { dated, undated };
}

// ============ T2 / T4: calendar-day grouping ============

function calendarDateKey(instantMs: number, timeZone: string): string {
  // en-CA gives YYYY-MM-DD directly, which is exactly the comparable,
  // timezone-free key this module needs (OD1: grouping happens in the
  // viewer's zone; T2: the boundary is a single named constant, currently
  // midnight — DAY_BOUNDARY_HOUR is applied by shifting the instant before
  // formatting, below, rather than by special-casing the formatter).
  const shifted = instantMs - DAY_BOUNDARY_HOUR * 60 * 60 * 1000;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(shifted));
}

/**
 * T4 [R]: "Day N" is only shown if the trip has a start_date and the day
 * falls within it. trips.start_date / end_date are DATE columns with no
 * time component (0002_trips.sql) — they are a calendar date the owner
 * picked, not an instant in any particular zone. Comparing them to the
 * viewer-local calendar-date key as plain YYYY-MM-DD strings (rather than
 * parsing both to Date instants and risking a timezone double-application)
 * is the smallest-assumption way to answer "does this day fall within the
 * trip's dates" without inventing a trip timezone (explicitly deferred,
 * OD1/[F]).
 */
export function computeDayNumber(
  dateKey: string,
  tripStartDate: string | null,
  tripEndDate: string | null
): number | null {
  if (!tripStartDate) return null;
  if (dateKey < tripStartDate) return null;
  if (tripEndDate && dateKey > tripEndDate) return null;

  const [sy, sm, sd] = tripStartDate.split("-").map(Number);
  const [dy, dm, dd] = dateKey.split("-").map(Number);
  // Both sides are plain calendar dates; Date.UTC here is just a
  // calendar-day-count calculator, not a timezone conversion — no instant
  // from either value is ever compared against a real moment in time.
  const startDays = Math.floor(Date.UTC(sy, sm - 1, sd) / 86_400_000);
  const dayDays = Math.floor(Date.UTC(dy, dm - 1, dd) / 86_400_000);
  return dayDays - startDays + 1;
}

/**
 * T2/T3/T4 [R]: groups already-dated, already-sorted items into days.
 * T3: days without media simply never appear — this function only ever
 * produces a DayGroup for a dateKey that has at least one item.
 */
export function computeDayGroups<M extends TimelineMedia>(
  dated: TimelineItem<M>[],
  timeZone: string,
  tripStartDate: string | null,
  tripEndDate: string | null
): DayGroup<M>[] {
  const groups = new Map<string, TimelineItem<M>[]>();

  for (const item of dated) {
    const key = calendarDateKey(item.sortInstant, timeZone);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, items]) => ({
      dateKey,
      dayNumber: computeDayNumber(dateKey, tripStartDate, tripEndDate),
      items,
    }));
}

// ============ T6/T7: clustering for time markers and contributors ============

/**
 * T6 [R]: splits an already-sorted list of items (within one day, or within
 * Undated — the function doesn't care which) into clusters separated by a
 * gap >= CLUSTER_GAP_SECONDS. The first cluster of the list always has
 * startsNewCluster = true so a day's first item always gets a time marker.
 */
export function computeClusters<M extends TimelineMedia>(
  items: TimelineItem<M>[]
): Cluster<M>[] {
  const clusters: Cluster<M>[] = [];
  let current: TimelineItem<M>[] = [];

  for (const item of items) {
    if (current.length === 0) {
      current.push(item);
      continue;
    }
    const prev = current[current.length - 1];
    const gapSeconds = (item.sortInstant - prev.sortInstant) / 1000;
    if (gapSeconds >= CLUSTER_GAP_SECONDS) {
      clusters.push({ markerInstant: current[0].sortInstant, startsNewCluster: true, items: current });
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length > 0) {
    clusters.push({ markerInstant: current[0].sortInstant, startsNewCluster: true, items: current });
  }
  return clusters;
}

/** T7 [H], Tier 2: distinct uploader ids actually present in a cluster,
 * excluding null (uploader_id is nullable — ON DELETE SET NULL, 0005). */
export function clusterContributorIds<M extends TimelineMedia>(cluster: Cluster<M>): string[] {
  const seen = new Set<string>();
  for (const item of cluster.items) {
    if (item.media.uploader_id) seen.add(item.media.uploader_id);
  }
  return Array.from(seen);
}

// ============ Featured-tile rule (section 5, Tier 2, [H]) ============

/**
 * Deterministic, non-AI, non-curated "editorial weight" rule. Pure
 * function per the spec's own requirement ("kept outside any DOM or
 * Next.js-specific code so it can be reused by a future native layout
 * engine"). Ship disabled by default (see FEATURED_TILES_ENABLED below)
 * until validated against real trips.
 *
 * NOTE: this function decides the TRIGGER only. The "skip if it would
 * violate the last-row stretch cap" part of the spec is a row-layout
 * decision that depends on neighbouring items' aspect ratios, which this
 * function has no visibility into — that final skip/keep decision belongs
 * to the justified-layout algorithm (component layer), using
 * LAST_ROW_MAX_STRETCH exported above.
 */
export function isFeaturedTrigger(args: {
  isFirstOfDay: boolean;
  startsNewCluster: boolean;
  isPhoto: boolean;
}): boolean {
  if (!args.isPhoto) return false; // videos excluded — spec section 5.
  return args.isFirstOfDay || args.startsNewCluster;
}

/** Single switch to disable the featured-tile treatment everywhere with no
 * other code change, per the spec's explicit "ship behind one constant"
 * instruction. Flip to true only after real-trip validation. */
export const FEATURED_TILES_ENABLED = false;

// ============ Truncation detection (section 14 / 0.4) ============

/**
 * The backend row cap (local config: 1000; hosted: unverified per the
 * spec) must never be hardcoded into this check. Callers should fetch
 * `limit + 1` rows and pass that count plus the limit actually requested;
 * this function only does the arithmetic, so the one place that knows the
 * real cap is the query layer (Claude 1's ownership), not here.
 */
export function detectTruncation(returnedCount: number, requestedLimit: number): {
  truncated: boolean;
  shownCount: number;
} {
  const truncated = returnedCount > requestedLimit;
  return { truncated, shownCount: truncated ? requestedLimit : returnedCount };
}
