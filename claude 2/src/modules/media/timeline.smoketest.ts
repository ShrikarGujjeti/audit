/**
 * Minimal, dependency-free smoke tests for the pure timeline module.
 * Run with: npx tsx src/modules/media/timeline.smoketest.ts
 * (or compiled + run with node — see the verification log in the handoff).
 * Not a replacement for a real test runner; exists so these rules are
 * checked by something other than visual code review before Core ships.
 */
import {
  buildTimelineItems,
  computeDayGroups,
  computeDayNumber,
  computeClusters,
  isFeaturedTrigger,
  sanitizeDimensions,
  clampAspectRatio,
  sanitizeCapturedAt,
  detectTruncation,
  CLUSTER_GAP_SECONDS,
  type TimelineMedia,
} from "./timeline";

let failures = 0;
function assert(name: string, cond: boolean) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok:   ${name}`);
  }
}

function media(partial: Partial<TimelineMedia> & { id: string }): TimelineMedia {
  return {
    uploader_id: "user-1",
    media_type: "photo",
    captured_at: null,
    uploaded_at: "2026-02-14T10:00:00Z",
    created_at: "2026-02-14T10:00:00Z",
    width: 1000,
    height: 800,
    duration_seconds: null,
    ...partial,
  } as TimelineMedia;
}

// --- T1/T5: undated items never leak into the dated list, even when their
// upload time would otherwise sort them into the middle of a day.
{
  const items = [
    media({ id: "a", captured_at: "2026-02-14T08:00:00Z" }),
    media({ id: "b", captured_at: null, uploaded_at: "2026-02-14T09:00:00Z" }),
    media({ id: "c", captured_at: "2026-02-14T20:00:00Z" }),
  ];
  const { dated, undated } = buildTimelineItems(items);
  assert("T1: exactly 2 dated items", dated.length === 2);
  assert("T5: exactly 1 undated item", undated.length === 1 && undated[0].media.id === "b");
  assert("T1: dated items are chronologically ordered", dated[0].media.id === "a" && dated[1].media.id === "c");
}

// --- Sanity-bound captured_at is treated as absent.
{
  const futureMs = Date.now() + 1000 * 60 * 60 * 24 * 365; // 1 year in the future
  const items = [
    media({ id: "future", captured_at: new Date(futureMs).toISOString() }),
    media({ id: "pre1990", captured_at: "1980-01-01T00:00:00Z" }),
    media({ id: "sane", captured_at: "2026-02-14T08:00:00Z" }),
  ];
  const { dated, undated } = buildTimelineItems(items);
  assert("future/pre-1990 captured_at treated as undated", dated.length === 1 && dated[0].media.id === "sane");
  assert("two bad-captured-at items land in Undated", undated.length === 2);
}

// --- T4: day numbering against a trip start_date, as plain calendar dates.
{
  assert("day 1 == trip start date", computeDayNumber("2026-02-14", "2026-02-14", "2026-02-19") === 1);
  assert("day 3 is start+2", computeDayNumber("2026-02-16", "2026-02-14", "2026-02-19") === 3);
  assert("before trip start => null", computeDayNumber("2026-02-10", "2026-02-14", "2026-02-19") === null);
  assert("after trip end => null", computeDayNumber("2026-02-25", "2026-02-14", "2026-02-19") === null);
  assert("no trip start_date => null", computeDayNumber("2026-02-14", null, null) === null);
}

// --- T2/T3: grouping only produces groups for days that actually have media.
{
  const { dated } = buildTimelineItems([
    media({ id: "a", captured_at: "2026-02-14T08:00:00Z" }),
    media({ id: "b", captured_at: "2026-02-16T08:00:00Z" }),
  ]);
  const groups = computeDayGroups(dated, "UTC", "2026-02-14", "2026-02-19");
  assert("only 2 day groups, not 6 for the whole trip", groups.length === 2);
  assert("groups sorted ascending by date", groups[0].dateKey < groups[1].dateKey);
}

// --- T6: clustering splits on the gap threshold, not on arbitrary boundaries.
{
  const base = Date.parse("2026-02-14T08:00:00Z");
  const bInstant = base + 5 * 60 * 1000; // +5 min from a, same cluster
  const cInstant = bInstant + (CLUSTER_GAP_SECONDS + 60) * 1000; // past the gap, measured from b (the previous item), not from a
  const { dated } = buildTimelineItems([
    media({ id: "a", captured_at: new Date(base).toISOString() }),
    media({ id: "b", captured_at: new Date(bInstant).toISOString() }),
    media({ id: "c", captured_at: new Date(cInstant).toISOString() }),
  ]);
  const clusters = computeClusters(dated);
  assert("two clusters from one gap", clusters.length === 2);
  assert("first cluster has 2 items", clusters[0].items.length === 2);
  assert("second cluster has 1 item", clusters[1].items.length === 1);
}

// --- Featured-tile trigger: photo + (day-start or cluster-start) only.
{
  assert("photo at day start => featured trigger", isFeaturedTrigger({ isFirstOfDay: true, startsNewCluster: true, isPhoto: true }));
  assert("video never featured, even at day start", !isFeaturedTrigger({ isFirstOfDay: true, startsNewCluster: true, isPhoto: false }));
  assert("mid-cluster photo not featured", !isFeaturedTrigger({ isFirstOfDay: false, startsNewCluster: false, isPhoto: true }));
}

// --- Untrusted dimensions: non-finite/zero/negative all become null.
{
  assert("negative height => null", sanitizeDimensions(100, -5) === null);
  assert("zero width => null", sanitizeDimensions(0, 100) === null);
  assert("NaN => null", sanitizeDimensions(NaN, 100) === null);
  assert("Infinity => null", sanitizeDimensions(100, Infinity) === null);
  assert("valid dims pass through", sanitizeDimensions(1920, 1080)?.width === 1920);
}

// --- Aspect ratio clamping never divides by zero or returns non-finite.
{
  assert("extreme pano clamps to MAX", clampAspectRatio({ width: 100000, height: 1 }) === 8);
  assert("extreme portrait clamps to MIN", clampAspectRatio({ width: 1, height: 100000 }) === 0.25);
  assert("null dims => 1 (stable box)", clampAspectRatio(null) === 1);
}

// --- sanitizeCapturedAt direct unit checks.
{
  assert("null in => null out", sanitizeCapturedAt(null) === null);
  assert("garbage string => null", sanitizeCapturedAt("not-a-date") === null);
  assert("valid ISO => a finite number", Number.isFinite(sanitizeCapturedAt("2026-02-14T08:00:00Z")));
}

// --- Truncation detection: the exact "limit+1" technique the spec requires.
{
  assert("returned == limit => not truncated", detectTruncation(500, 500).truncated === false);
  assert("returned > limit (limit+1 fetch) => truncated", detectTruncation(501, 500).truncated === true);
  assert("shownCount caps at the limit when truncated", detectTruncation(501, 500).shownCount === 500);
}

if (failures > 0) {
  console.error(`\n${failures} smoke test(s) failed.`);
  process.exit(1);
}
console.log("\nAll timeline smoke tests passed.");
