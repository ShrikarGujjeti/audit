"use client";

import { TimeMarker } from "./TimeMarker";
import { MediaGrid, type GridItem } from "./MediaGrid";

export type DayCluster = { markerInstant: number; items: GridItem[] };

export function DaySection({
  dateKey,
  dayNumber,
  timeZone,
  clusters,
  onOpen,
}: {
  dateKey: string;
  dayNumber: number | null;
  timeZone: string;
  /** Pre-clustered by computeClusters (T6) — one TimeMarker + MediaGrid per
   * cluster, so a day with several quiet-gap-separated moments reads as
   * several moments, not one undifferentiated grid. */
  clusters: DayCluster[];
  onOpen: (mediaId: string) => void;
}) {
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date(`${dateKey}T12:00:00Z`));

  const total = clusters.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <section aria-labelledby={`day-${dateKey}`} className="mb-16">
      <h2 id={`day-${dateKey}`} className="mb-4 text-[22px] leading-[28px] text-[var(--tc-ink-primary)]">
        {dayNumber !== null ? `Day ${dayNumber} · ` : ""}
        {dateLabel}
        <span className="ml-2 text-[13px] font-normal text-[var(--tc-ink-secondary)]">
          {total} {total === 1 ? "memory" : "memories"}
        </span>
      </h2>
      {clusters.map((cluster, i) => (
        <div key={i} className="mb-6 last:mb-0">
          <TimeMarker instantMs={cluster.markerInstant} timeZone={timeZone} />
          <MediaGrid items={cluster.items} timeZone={timeZone} onOpen={onOpen} />
        </div>
      ))}
    </section>
  );
}
