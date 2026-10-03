"use client";

import { useMemo } from "react";
import type { Media } from "@/modules/media/queries";
import type { TripMember } from "@/modules/memberships/queries";
import {
  buildTimelineItems,
  computeDayGroups,
  computeClusters,
  isFeaturedTrigger,
  FEATURED_TILES_ENABLED,
  detectTruncation,
} from "@/modules/media/timeline";
import { resolveAttribution } from "@/modules/media/accessibleName";
import { DaySection, type DayCluster } from "./DaySection";
import { UndatedSection } from "./UndatedSection";
import { ViewerModal, useViewerRouting, type ViewerItem } from "./ViewerModal";
import type { GridItem } from "./MediaGrid";
import type { MediaTileData } from "./MediaTile";

/**
 * [H]: the hosted PostgREST row cap is NOT verified (spec OD3 / section
 * 0.3 preflight item 3). This constant exists only so the truncation UI
 * has something to compare against today; it is NOT a sound truncation
 * detector on its own, because listTripMedia (Claude 1's query) does not
 * yet accept a `limit+1` parameter. See the handoff: this is a reported
 * dependency, not a fix I made to Claude 1's query.
 */
const ASSUMED_ROW_CAP = 1000;

export function MemoriesSection({
  media,
  members,
  currentUserId,
  tripOwnerId,
  tripStartDate,
  tripEndDate,
}: {
  media: Media[];
  members: TripMember[];
  currentUserId: string | null;
  tripOwnerId: string;
  tripStartDate: string | null;
  tripEndDate: string | null;
}) {
  const { openId, open, close, navigateTo } = useViewerRouting();
  // OD1 [D]: viewer-local, computed here (client component) rather than
  // passed from the server — the server's zone is not the viewer's zone.
  // useMemo (not useState) is enough: it can't change within a session.
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const { dayGroups, undated, truncation, ordered } = useMemo(() => {
    const { dated, undated: undatedItems } = buildTimelineItems(media);
    const groups = computeDayGroups(dated, timeZone, tripStartDate, tripEndDate);

    function toGridItem(item: (typeof dated)[number], featured: boolean): GridItem {
      const attribution = resolveAttribution(item.media.uploader_id, members);
      const data: MediaTileData = {
        id: item.media.id,
        mediaType: item.media.media_type,
        instantMs: item.sortInstant,
        durationSeconds: item.media.duration_seconds,
        attribution,
        mimeType: item.media.mime_type,
      };
      return { data, dimensions: item.dimensions, featured };
    }

    const dayGroupsOut = groups.map((group) => {
      const clusters = computeClusters(group.items);
      const dayClusters: DayCluster[] = clusters.map((cluster, clusterIdx) => ({
        markerInstant: cluster.markerInstant,
        items: cluster.items.map((item, itemIdx) => {
          const featured =
            FEATURED_TILES_ENABLED &&
            isFeaturedTrigger({
              isFirstOfDay: clusterIdx === 0 && itemIdx === 0,
              startsNewCluster: itemIdx === 0,
              isPhoto: item.media.media_type === "photo",
            });
          return toGridItem(item, featured);
        }),
      }));
      return { dateKey: group.dateKey, dayNumber: group.dayNumber, clusters: dayClusters };
    });

    const undatedOut: GridItem[] = undatedItems.map((item) => toGridItem(item, false));

    // Full chronological order (dated, in order, then undated) — what the
    // viewer's prev/next and position counter use. Matches T1/T5: undated
    // items exist, but never interleaved into day order.
    const orderedOut: ViewerItem[] = [...dated, ...undatedItems].map((item) => ({
      data: toGridItem(item, false).data,
      canRemove:
        !!currentUserId && (currentUserId === item.media.uploader_id || currentUserId === tripOwnerId),
    }));

    return {
      dayGroups: dayGroupsOut,
      undated: undatedOut,
      truncation: detectTruncation(media.length, ASSUMED_ROW_CAP),
      ordered: orderedOut,
    };
  }, [media, members, timeZone, tripStartDate, tripEndDate, currentUserId, tripOwnerId]);

  const isEmpty = media.length === 0;

  return (
    <section aria-label="Memories" className="mt-10">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-medium text-[var(--tc-ink-primary)]">
          Memories {!isEmpty && `· ${media.length}`}
        </h2>
        {/* Placeholder only — Claude 3 owns the real file picker / upload
            queue / tray. This button exists so the page renders something
            functional today; replace with the real component. */}
        <AddMemoriesButtonPlaceholder />
      </div>

      {truncation.truncated ? (
        <p role="status" className="mb-6 text-sm text-[var(--tc-ink-secondary)]">
          Showing the earliest {truncation.shownCount} memories; newer ones aren&rsquo;t shown yet.
        </p>
      ) : null}

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-[var(--tc-hairline)] p-10 text-center">
          <p className="text-[var(--tc-ink-secondary)]">No memories yet.</p>
          <p className="mt-1 text-sm text-[var(--tc-ink-secondary)]">Add the first one.</p>
        </div>
      ) : (
        <>
          {dayGroups.map((group) => (
            <DaySection
              key={group.dateKey}
              dateKey={group.dateKey}
              dayNumber={group.dayNumber}
              timeZone={timeZone}
              clusters={group.clusters}
              onOpen={open}
            />
          ))}
          <UndatedSection items={undated} timeZone={timeZone} onOpen={open} />
        </>
      )}

      <ViewerModal items={ordered} openId={openId} onClose={close} onNavigate={navigateTo} timeZone={timeZone} />
    </section>
  );
}

function AddMemoriesButtonPlaceholder() {
  return (
    <button
      type="button"
      disabled
      title="Upload queue not yet implemented — Claude 3's ownership area"
      className="rounded-md bg-[var(--tc-ink-primary)] px-4 py-2 text-sm font-medium text-[var(--tc-surface-page)] opacity-50"
    >
      Add memories
    </button>
  );
}
