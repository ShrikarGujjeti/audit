/**
 * Pure accessible-name construction for media tiles and the viewer.
 * Framework-independent per Appendix G. Matches the exact pattern required
 * by TRIP_CHALO_PHASE6_EXPERIENCE_SPEC_v2.md section 17:
 *   "Photo, 6:42 pm, added by {name}"
 *   "Video, 0:42, added by {name}"
 *   uploader name falls back to "A former member" when unresolvable.
 */

export type AttributionName = { kind: "known"; name: string } | { kind: "former_member" };

/** Resolves a display name for a media item's uploader_id against the
 * current member list. A null result (not in the current member list)
 * means the uploader left the trip — 0.4's backend-reality note: "An
 * uploader who left has an unresolvable name." This function never makes
 * a network call; the caller already has the member list in hand. */
export function resolveAttribution(
  uploaderId: string | null,
  members: ReadonlyArray<{ user_id: string; display_name: string }>
): AttributionName {
  if (!uploaderId) return { kind: "former_member" };
  const match = members.find((m) => m.user_id === uploaderId);
  if (!match || !match.display_name) return { kind: "former_member" };
  return { kind: "known", name: match.display_name };
}

function attributionLabel(attribution: AttributionName): string {
  return attribution.kind === "known" ? attribution.name : "a former member";
}

function formatPreciseTime(instantMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  })
    .format(new Date(instantMs))
    .toLowerCase()
    .replace(/\s/g, " "); // normalize NBSP some ICU implementations insert before am/pm
}

function formatDuration(durationSeconds: number | null): string {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return "0:00";
  }
  const total = Math.round(durationSeconds);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function mediaAccessibleName(args: {
  mediaType: "photo" | "video";
  /** Null for Undated items — see buildAccessibleTimeOrUndated below for
   * the caller-facing wrapper that handles both cases. */
  instantMs: number | null;
  durationSeconds: number | null;
  attribution: AttributionName;
  timeZone: string;
}): string {
  const who = attributionLabel(args.attribution);
  if (args.mediaType === "video") {
    return `Video, ${formatDuration(args.durationSeconds)}, added by ${who}`;
  }
  if (args.instantMs === null) {
    return `Photo, no capture time, added by ${who}`;
  }
  return `Photo, ${formatPreciseTime(args.instantMs, args.timeZone)}, added by ${who}`;
}

/** Viewer position announcement — section 17: 'a polite live region
 * announces "Photo 12 of 84"'. */
export function viewerPositionAnnouncement(args: {
  mediaType: "photo" | "video";
  index1Based: number;
  total: number;
}): string {
  const label = args.mediaType === "video" ? "Video" : "Photo";
  return `${label} ${args.index1Based} of ${args.total}`;
}
